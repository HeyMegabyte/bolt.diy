/**
 * Stage 2.2(c) — deploySiteFunctions publish orchestration.
 *
 * Gates the functions deploy on WfP config + the `customEndpoints` entitlement,
 * then routes the container's bundle result: bad build → keep last-good (never
 * touch WfP); empty functions/ → remove any stale script; good build → upload
 * `site-<siteId>`. Never throws — a functions failure must not block the static
 * publish. wfp_dispatch + billing are mocked; this locks the branch logic.
 */
jest.mock('../services/wfp_dispatch.js', () => ({
  isWfpConfigured: jest.fn(() => true),
  siteFunctionsScriptName: (id: string) => `site-${id}`,
  uploadSiteFunctionsWorker: jest.fn(),
  deleteSiteFunctionsWorker: jest.fn(),
}));
jest.mock('../services/billing.js', () => ({ getOrgEntitlements: jest.fn() }));

import { deploySiteFunctions } from '../services/functions_deploy.js';
import { getOrgEntitlements } from '../services/billing.js';
import {
  isWfpConfigured,
  uploadSiteFunctionsWorker,
  deleteSiteFunctionsWorker,
} from '../services/wfp_dispatch.js';
import type { Env } from '../types/env.js';

const mockEnt = getOrgEntitlements as unknown as jest.Mock;
const mockConfigured = isWfpConfigured as unknown as jest.Mock;
const mockUpload = uploadSiteFunctionsWorker as unknown as jest.Mock;
const mockDelete = deleteSiteFunctionsWorker as unknown as jest.Mock;

const env = { DB: {} } as unknown as Env;
const entitled = (v: boolean) => mockEnt.mockResolvedValue({ customEndpoints: v });

beforeEach(() => {
  mockConfigured.mockReturnValue(true);
  mockUpload.mockReset().mockResolvedValue({ ok: true, scriptName: 'site-abc' });
  mockDelete.mockReset().mockResolvedValue(undefined);
  mockEnt.mockReset();
});

describe('deploySiteFunctions', () => {
  it('short-circuits when WfP is unconfigured (no entitlement/upload calls)', async () => {
    mockConfigured.mockReturnValue(false);
    const out = await deploySiteFunctions(env, { siteId: 'abc', orgId: 'org1', build: { ok: true, script: 'x' } });
    expect(out.status).toBe('wfp_unconfigured');
    expect(mockEnt).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('skips (no upload) when the org is not entitled to customEndpoints', async () => {
    entitled(false);
    const out = await deploySiteFunctions(env, { siteId: 'abc', orgId: 'org1', build: { ok: true, script: 'x' } });
    expect(out.status).toBe('skipped_not_entitled');
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('on a bad build: keeps last-good (never touches WfP) + surfaces the error', async () => {
    entitled(true);
    const out = await deploySiteFunctions(env, { siteId: 'abc', orgId: 'org1', build: { ok: false, error: 'Reserved path: api/events' } });
    expect(out.status).toBe('build_failed');
    if (out.status === 'build_failed') expect(out.error).toContain('Reserved path');
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('removes any stale script when functions/ is empty', async () => {
    entitled(true);
    const out = await deploySiteFunctions(env, { siteId: 'abc', orgId: 'org1', build: { ok: true, empty: true } });
    expect(out.status).toBe('removed');
    expect(mockDelete).toHaveBeenCalledWith(env, 'abc');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('uploads site-<siteId> on a good build', async () => {
    entitled(true);
    const out = await deploySiteFunctions(env, { siteId: 'abc', orgId: 'org1', build: { ok: true, script: 'export default {}' } });
    expect(out.status).toBe('deployed');
    if (out.status === 'deployed') expect(out.scriptName).toBe('site-abc');
    expect(mockUpload).toHaveBeenCalledWith(env, 'abc', 'export default {}');
  });

  it('surfaces an upload failure (last-good stays — PUT never overwrote)', async () => {
    entitled(true);
    mockUpload.mockResolvedValue({ ok: false, error: 'invalid module', status: 400 });
    const out = await deploySiteFunctions(env, { siteId: 'abc', orgId: 'org1', build: { ok: true, script: 's' } });
    expect(out.status).toBe('upload_failed');
    if (out.status === 'upload_failed') {
      expect(out.error).toBe('invalid module');
      expect(out.httpStatus).toBe(400);
    }
  });

  it('never throws — an entitlement lookup error degrades to a skip', async () => {
    mockEnt.mockRejectedValue(new Error('D1 down'));
    const out = await deploySiteFunctions(env, { siteId: 'abc', orgId: 'org1', build: { ok: true, script: 's' } });
    expect(out.status).toBe('skipped_not_entitled');
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
