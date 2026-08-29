/**
 * Stage 2.2(c) — deploySiteFunctions publish orchestration + deploy-state signal.
 *
 * Gates the functions deploy on WfP config + the `customEndpoints` entitlement,
 * then routes the container's bundle result: bad build → keep last-good (never
 * touch WfP); empty functions/ → remove any stale script; good build → upload
 * `site-<siteId>`. On a successful upload/remove it PERSISTS the deploy state to
 * `sites.functions_deployed_at` (the signal Stage 3.1 dispatch reads via
 * siteHasDeployedFunctions). Never throws — a functions failure (or a D1 signal
 * write failure) must not block the static publish. wfp_dispatch + billing + db
 * are mocked; this locks the branch logic + the signal write.
 */
jest.mock('../services/wfp_dispatch.js', () => ({
  isWfpConfigured: jest.fn(() => true),
  siteFunctionsScriptName: (id: string) => `site-${id}`,
  uploadSiteFunctionsWorker: jest.fn(),
  deleteSiteFunctionsWorker: jest.fn(),
}));
jest.mock('../services/billing.js', () => ({ getOrgEntitlements: jest.fn() }));
jest.mock('../services/db.js', () => ({ dbUpdate: jest.fn(), dbQueryOne: jest.fn() }));

import { deploySiteFunctions, siteHasDeployedFunctions } from '../services/functions_deploy.js';
import { getOrgEntitlements } from '../services/billing.js';
import {
  isWfpConfigured,
  uploadSiteFunctionsWorker,
  deleteSiteFunctionsWorker,
} from '../services/wfp_dispatch.js';
import { dbUpdate, dbQueryOne } from '../services/db.js';
import type { Env } from '../types/env.js';

const mockEnt = getOrgEntitlements as unknown as jest.Mock;
const mockConfigured = isWfpConfigured as unknown as jest.Mock;
const mockUpload = uploadSiteFunctionsWorker as unknown as jest.Mock;
const mockDelete = deleteSiteFunctionsWorker as unknown as jest.Mock;
const mockDbUpdate = dbUpdate as unknown as jest.Mock;
const mockQueryOne = dbQueryOne as unknown as jest.Mock;

const env = { DB: {} } as unknown as Env;
const entitled = (v: boolean) => mockEnt.mockResolvedValue({ customEndpoints: v });

beforeEach(() => {
  mockConfigured.mockReturnValue(true);
  mockUpload.mockReset().mockResolvedValue({ ok: true, scriptName: 'site-abc' });
  mockDelete.mockReset().mockResolvedValue(undefined);
  mockEnt.mockReset();
  mockDbUpdate.mockReset().mockResolvedValue({ error: null, changes: 1 });
  mockQueryOne.mockReset();
});

describe('deploySiteFunctions', () => {
  it('short-circuits when WfP is unconfigured (no entitlement/upload/signal-write)', async () => {
    mockConfigured.mockReturnValue(false);
    const out = await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 'x' },
    });
    expect(out.status).toBe('wfp_unconfigured');
    expect(mockEnt).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('skips (no upload/signal-write) when the org is not entitled to customEndpoints', async () => {
    entitled(false);
    const out = await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 'x' },
    });
    expect(out.status).toBe('skipped_not_entitled');
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('on a bad build: keeps last-good (never touches WfP or the signal) + surfaces the error', async () => {
    entitled(true);
    const out = await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: false, error: 'Reserved path: api/events' },
    });
    expect(out.status).toBe('build_failed');
    if (out.status === 'build_failed') expect(out.error).toContain('Reserved path');
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('removes any stale script + CLEARS the signal when functions/ is empty', async () => {
    entitled(true);
    const out = await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, empty: true },
    });
    expect(out.status).toBe('removed');
    expect(mockDelete).toHaveBeenCalledWith(env, 'abc');
    expect(mockUpload).not.toHaveBeenCalled();
    // signal cleared → functions_deployed_at = null
    expect(mockDbUpdate).toHaveBeenCalledWith(
      env.DB,
      'sites',
      { functions_deployed_at: null },
      'id = ?',
      ['abc'],
    );
  });

  it('uploads site-<siteId> + SETS the signal on a good build', async () => {
    entitled(true);
    const out = await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 'export default {}' },
    });
    expect(out.status).toBe('deployed');
    if (out.status === 'deployed') expect(out.scriptName).toBe('site-abc');
    expect(mockUpload).toHaveBeenCalledWith(env, 'abc', 'export default {}');
    // signal set → functions_deployed_at = a timestamp string, scoped to the site
    const call = mockDbUpdate.mock.calls.at(-1);
    expect(call[0]).toBe(env.DB);
    expect(call[1]).toBe('sites');
    expect(typeof call[2].functions_deployed_at).toBe('string');
    expect(call[3]).toBe('id = ?');
    expect(call[4]).toEqual(['abc']);
  });

  it('does NOT set the signal on an upload failure (last-good stays)', async () => {
    entitled(true);
    mockUpload.mockResolvedValue({ ok: false, error: 'invalid module', status: 400 });
    const out = await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 's' },
    });
    expect(out.status).toBe('upload_failed');
    if (out.status === 'upload_failed') {
      expect(out.error).toBe('invalid module');
      expect(out.httpStatus).toBe(400);
    }
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('never throws — a signal-write failure still returns deployed (fail-soft)', async () => {
    entitled(true);
    mockDbUpdate.mockRejectedValue(new Error('D1 down'));
    const out = await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 's' },
    });
    expect(out.status).toBe('deployed');
  });

  it('never throws — an entitlement lookup error degrades to a skip', async () => {
    mockEnt.mockRejectedValue(new Error('D1 down'));
    const out = await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 's' },
    });
    expect(out.status).toBe('skipped_not_entitled');
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('siteHasDeployedFunctions', () => {
  it('true when the site has a functions_deployed_at timestamp', async () => {
    mockQueryOne.mockResolvedValue({ functions_deployed_at: '2026-08-29T00:00:00.000Z' });
    expect(await siteHasDeployedFunctions(env.DB, 'abc')).toBe(true);
  });

  it('false when functions_deployed_at is null (removed / never deployed)', async () => {
    mockQueryOne.mockResolvedValue({ functions_deployed_at: null });
    expect(await siteHasDeployedFunctions(env.DB, 'abc')).toBe(false);
  });

  it('false when the site row is missing', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await siteHasDeployedFunctions(env.DB, 'ghost')).toBe(false);
  });

  it('excludes soft-deleted sites in the lookup SQL', async () => {
    mockQueryOne.mockResolvedValue(null);
    await siteHasDeployedFunctions(env.DB, 'abc');
    const sql = mockQueryOne.mock.calls.at(-1)[1] as string;
    expect(sql).toMatch(/deleted_at IS NULL/i);
    expect(mockQueryOne.mock.calls.at(-1)[2]).toEqual(['abc']);
  });
});
