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
jest.mock('../services/ai_env_vars.js', () => ({ resolveEnvVarsForFunctions: jest.fn() }));
jest.mock('../services/functions/internal.js', () => ({
  signFunctionToken: jest.fn(async (secret: string, siteId: string) => `${siteId}.sig-${secret}`),
}));

import {
  deploySiteFunctions,
  siteHasDeployedFunctions,
  functionsBundleKey,
  persistFunctionsBundle,
  readFunctionsBundle,
} from '../services/functions_deploy.js';
import { getOrgEntitlements } from '../services/billing.js';
import { resolveEnvVarsForFunctions } from '../services/ai_env_vars.js';
import { signFunctionToken } from '../services/functions/internal.js';
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
const mockResolveSecrets = resolveEnvVarsForFunctions as unknown as jest.Mock;
const mockSign = signFunctionToken as unknown as jest.Mock;

const env = { DB: {} } as unknown as Env;
const entitled = (v: boolean) => mockEnt.mockResolvedValue({ customEndpoints: v });

beforeEach(() => {
  mockConfigured.mockReturnValue(true);
  mockUpload.mockReset().mockResolvedValue({ ok: true, scriptName: 'site-abc' });
  mockDelete.mockReset().mockResolvedValue(undefined);
  mockEnt.mockReset();
  mockDbUpdate.mockReset().mockResolvedValue({ error: null, changes: 1 });
  mockQueryOne.mockReset();
  mockResolveSecrets.mockReset().mockResolvedValue({});
  mockSign.mockClear(); // clear calls, KEEP the mocked impl (a mockReset would drop it)
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
    expect(mockDelete).toHaveBeenCalledWith(env, 'abc', { preview: undefined });
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
    expect(mockUpload).toHaveBeenCalledWith(env, 'abc', 'export default {}', {
      preview: undefined,
    });
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

  // Stage 2.3 — preview mode uploads the `-preview` slot WITHOUT touching the
  // live deploy signal, so the owner can test before promoting.
  it('preview: uploads to the preview slot + does NOT write the live deploy signal', async () => {
    entitled(true);
    mockUpload.mockResolvedValue({ ok: true, scriptName: 'site-abc-preview' });
    const out = await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 'export default {}' },
      preview: true,
    });
    expect(out.status).toBe('deployed');
    if (out.status === 'deployed') expect(out.scriptName).toBe('site-abc-preview');
    expect(mockUpload).toHaveBeenCalledWith(env, 'abc', 'export default {}', { preview: true });
    // the LIVE signal is never touched in preview mode
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('preview + empty build removes ONLY the preview slot + leaves the live signal intact', async () => {
    entitled(true);
    const out = await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, empty: true },
      preview: true,
    });
    expect(out.status).toBe('removed');
    expect(mockDelete).toHaveBeenCalledWith(env, 'abc', { preview: true });
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  // Stage 4.1 — env.SECRETS: resolved site+org env-vars injected as `secretsJson`.
  it('injects resolved site+org env-vars as secretsJson on the upload', async () => {
    entitled(true);
    mockResolveSecrets.mockResolvedValue({ API_KEY: 'x', TOKEN: 'y' });
    await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 'export default {}' },
    });
    expect(mockResolveSecrets).toHaveBeenCalledWith(env, 'org1', 'abc');
    expect(mockUpload).toHaveBeenCalledWith(env, 'abc', 'export default {}', {
      preview: undefined,
      secretsJson: JSON.stringify({ API_KEY: 'x', TOKEN: 'y' }),
    });
  });

  it('passes NO secretsJson when the site has no env-vars', async () => {
    entitled(true);
    mockResolveSecrets.mockResolvedValue({});
    await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 's' },
    });
    const opts = mockUpload.mock.calls.at(-1)![3] as { secretsJson?: string };
    expect(opts.secretsJson).toBeUndefined();
  });

  it('fail-soft — a secrets-resolve failure still deploys (no secretsJson)', async () => {
    entitled(true);
    mockResolveSecrets.mockRejectedValue(new Error('D1 down'));
    const out = await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 's' },
    });
    expect(out.status).toBe('deployed');
    const opts = mockUpload.mock.calls.at(-1)![3] as { secretsJson?: string };
    expect(opts.secretsJson).toBeUndefined();
  });

  it('preview deploy ALSO carries the resolved secrets', async () => {
    entitled(true);
    mockResolveSecrets.mockResolvedValue({ API_KEY: 'x' });
    mockUpload.mockResolvedValue({ ok: true, scriptName: 'site-abc-preview' });
    await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 's' },
      preview: true,
    });
    expect(mockUpload).toHaveBeenCalledWith(env, 'abc', 's', {
      preview: true,
      secretsJson: JSON.stringify({ API_KEY: 'x' }),
    });
  });

  // Stage 4.1(b) — the shared KV namespace id (env.FUNCTIONS_KV_ID) → kvNamespaceId.
  it('passes the shared KV namespace id (env.FUNCTIONS_KV_ID) as kvNamespaceId', async () => {
    entitled(true);
    const envKv = { DB: {}, FUNCTIONS_KV_ID: 'ns-shared-123' } as unknown as Env;
    await deploySiteFunctions(envKv, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 's' },
    });
    const opts = mockUpload.mock.calls.at(-1)![3] as { kvNamespaceId?: string };
    expect(opts.kvNamespaceId).toBe('ns-shared-123');
  });

  it('passes NO kvNamespaceId when FUNCTIONS_KV_ID is unset (KV not configured)', async () => {
    entitled(true);
    await deploySiteFunctions(env, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 's' },
    });
    const opts = mockUpload.mock.calls.at(-1)![3] as { kvNamespaceId?: string };
    expect(opts.kvNamespaceId).toBeUndefined();
  });

  // Stage 4.1(c) — the platform R2 bucket name (env.FUNCTIONS_R2_BUCKET) → r2BucketName.
  it('passes the R2 bucket name (env.FUNCTIONS_R2_BUCKET) as r2BucketName', async () => {
    entitled(true);
    const envR2 = { DB: {}, FUNCTIONS_R2_BUCKET: 'bkt-prod' } as unknown as Env;
    await deploySiteFunctions(envR2, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 's' },
    });
    const opts = mockUpload.mock.calls.at(-1)![3] as { r2BucketName?: string };
    expect(opts.r2BucketName).toBe('bkt-prod');
  });

  // Stage 4.1(d) — env.AI: sign + pass a per-site token + the internal service binding.
  it('signs + passes fnToken + fnService when the internal secret + service are set', async () => {
    entitled(true);
    const envAi = {
      DB: {},
      FUNCTIONS_INTERNAL_SECRET: 'sek',
      FUNCTIONS_INTERNAL_SERVICE: 'project-sites',
    } as unknown as Env;
    await deploySiteFunctions(envAi, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 's' },
    });
    expect(mockSign).toHaveBeenCalledWith('sek', 'abc');
    const opts = mockUpload.mock.calls.at(-1)![3] as { fnToken?: string; fnService?: string };
    expect(opts.fnToken).toBe('abc.sig-sek');
    expect(opts.fnService).toBe('project-sites');
  });

  it('passes NO fnToken when the internal secret is unset (env.AI not configured)', async () => {
    entitled(true);
    const envSvcOnly = {
      DB: {},
      FUNCTIONS_INTERNAL_SERVICE: 'project-sites',
    } as unknown as Env;
    await deploySiteFunctions(envSvcOnly, {
      siteId: 'abc',
      orgId: 'org1',
      build: { ok: true, script: 's' },
    });
    const opts = mockUpload.mock.calls.at(-1)![3] as { fnToken?: string; fnService?: string };
    expect(opts.fnToken).toBeUndefined();
    // fnService is still threaded through even without a token (harmless; shim needs BOTH)
    expect(opts.fnService).toBe('project-sites');
  });
});

describe('functions bundle persistence (Stage 2.3 preview source)', () => {
  it('functionsBundleKey is the per-site R2 key', () => {
    expect(functionsBundleKey('abc')).toBe('functions-bundles/abc.js');
  });

  it('persist then read round-trips the bundle text through R2', async () => {
    const store = new Map<string, string>();
    const bucket = {
      put: jest.fn(async (key: string, body: string) => {
        store.set(key, body);
      }),
      get: jest.fn(async (key: string) =>
        store.has(key) ? { text: async () => store.get(key)! } : null,
      ),
    };
    const e = { SITES_BUCKET: bucket } as unknown as Env;
    await persistFunctionsBundle(e, 'abc', 'export default { fetch() {} }');
    expect(bucket.put).toHaveBeenCalledWith(
      'functions-bundles/abc.js',
      'export default { fetch() {} }',
      { httpMetadata: { contentType: 'application/javascript' } },
    );
    expect(await readFunctionsBundle(e, 'abc')).toBe('export default { fetch() {} }');
  });

  it('readFunctionsBundle returns null when the site never persisted a bundle', async () => {
    const bucket = { get: jest.fn(async () => null) };
    const e = { SITES_BUCKET: bucket } as unknown as Env;
    expect(await readFunctionsBundle(e, 'ghost')).toBeNull();
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
