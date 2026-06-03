/**
 * Route coverage for the AI Environment Variables CRUD + import/export layer
 * (`src/routes/env_vars.ts`, convergence r43).
 *
 * This is a SECURITY-SENSITIVE surface: it stores per-org/site/MCP/endpoint/agent
 * key-value pairs ENCRYPTED-AT-REST (AES-GCM via `ai_crypto`/`ai_env_vars`), masks
 * secret values on the list path, and gates plaintext export behind an org-owner
 * membership row. The tests exercise each handler end-to-end through the real Hono
 * app, mocking ONLY the boundaries:
 *   - `ai_env_vars` service (`setEnvVar`/`listEnvVars`/`deleteEnvVar`) — the layer
 *     that owns the AES-GCM encrypt/decrypt + masking contract. We assert the route
 *     hands plaintext to `setEnvVar` (encryption-at-rest) and only ever returns the
 *     `value_masked` representation from the list path (never plaintext).
 *   - `ai_crypto` (`decrypt`) — used by the PATCH path to re-encrypt-in-place when
 *     the caller omits a new value.
 *   - `db` (`dbQueryOne`) — the PATCH current-row fetch + the owner-membership lookup.
 *   - `audit.js` (`writeAuditLog`).
 *
 * Coverage:
 *   - list: 401 (no auth), success (masked only — NEVER plaintext in the response),
 *     scope/site filter pass-through, 500 on service throw.
 *   - set/upsert: 401, 400 (bad JSON), 400 (missing/invalid scope), success
 *     (plaintext → setEnvVar encrypt-at-rest, masked record returned, audit), 400
 *     on service validation throw.
 *   - patch: 401, 400 (no id / bad JSON), 404 (org-scoped row miss = non-leak),
 *     success with explicit value, success with decrypt-and-re-set (omitted value),
 *     500 on decrypt failure.
 *   - delete: 401, 404 (org-scoped miss = non-leak), success + audit, 500 on throw.
 *   - import: 401, 400 (missing scope / missing dotenv), 0-pair no-op, 413 over cap,
 *     success (each pair → setEnvVar encrypt path, partial-failure accounting).
 *   - export: 401, 403 (plaintext export without owner role = non-leak), masked
 *     export (default — no plaintext), owner plaintext export.
 */

jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/ai_crypto.js', () => ({
  decrypt: jest.fn(async (_env: unknown, blob: string) => `dec(${blob})`),
}));

jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
}));

jest.mock('../services/ai_env_vars.js', () => ({
  setEnvVar: jest.fn(),
  listEnvVars: jest.fn(),
  deleteEnvVar: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { envVarsRoutes } from '../routes/env_vars.js';
import { setEnvVar, listEnvVars, deleteEnvVar } from '../services/ai_env_vars.js';
import { decrypt } from '../services/ai_crypto.js';
import { dbQueryOne } from '../services/db.js';
import { writeAuditLog } from '../services/audit.js';

const mockSetEnvVar = setEnvVar as unknown as jest.Mock;
const mockListEnvVars = listEnvVars as unknown as jest.Mock;
const mockDeleteEnvVar = deleteEnvVar as unknown as jest.Mock;
const mockDecrypt = decrypt as unknown as jest.Mock;
const mockDbQueryOne = dbQueryOne as unknown as jest.Mock;
const mockWriteAuditLog = writeAuditLog as unknown as jest.Mock;

// ─── Boundary fixtures ─────────────────────────────────────────────────────────

/**
 * Build a masked {@link EnvVar}-shaped record as the service would return it:
 * `value_masked` carries the redacted view; raw plaintext is NEVER present.
 */
function maskedRecord(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ev-1',
    org_id: 'org-1',
    scope: 'org',
    site_id: null,
    mcp_provider: null,
    endpoint_id: null,
    agent_id: null,
    key: 'API_TOKEN',
    value_masked: '••••cret',
    description: null,
    is_secret: true,
    exposed_to_ai: true,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    ...over,
  };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    MCP_ENCRYPTION_KEY: 'a'.repeat(44),
    ...overrides,
  } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

/**
 * Build the app with a middleware that seeds the auth context vars the handlers
 * read (`userId`, `orgId`, `requestId`). Passing no vars simulates an
 * unauthenticated request (no `orgId` → 401).
 */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', envVarsRoutes);
  return app;
}

/** Minimal ExecutionContext so the handlers' `waitUntil(...)` audit calls work. */
function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function req(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  env: Env,
  init: RequestInit = {},
) {
  return app.request(path, init, env, makeCtx());
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── GET /api/env-vars ──────────────────────────────────────────────────────────

describe('GET /api/env-vars', () => {
  it('returns 401 when org context is missing', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/env-vars', env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    // Must short-circuit before touching the service.
    expect(mockListEnvVars).not.toHaveBeenCalled();
  });

  it('returns the masked vars and NEVER leaks plaintext in the response', async () => {
    mockListEnvVars.mockResolvedValue([maskedRecord()]);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars', env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vars: Array<Record<string, unknown>> };
    expect(body.vars).toHaveLength(1);
    expect(body.vars[0].value_masked).toBe('••••cret');
    // Encryption-at-rest contract: no plaintext `value` field is surfaced on the
    // browser-facing list path, and the raw serialized payload contains no secret.
    expect(body.vars[0]).not.toHaveProperty('value');
    expect(JSON.stringify(body)).not.toMatch(/super-secret/);
    // The route never asked the service to unmask.
    expect(mockListEnvVars).toHaveBeenCalledTimes(1);
    const opts = mockListEnvVars.mock.calls[0][2] as { unmask?: boolean };
    expect(opts.unmask).toBeUndefined();
  });

  it('threads scope + scoping filters through to the service', async () => {
    mockListEnvVars.mockResolvedValue([]);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars?scope=site&siteId=site-9&mcpProvider=stripe', env);
    expect(res.status).toBe(200);
    const [, orgId, opts] = mockListEnvVars.mock.calls[0];
    expect(orgId).toBe('org-1');
    expect(opts).toMatchObject({ scope: 'site', siteId: 'site-9', mcpProvider: 'stripe' });
  });

  it('returns 500 when the service throws', async () => {
    mockListEnvVars.mockRejectedValue(new Error('D1 down'));
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars', env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ─── POST /api/env-vars ─────────────────────────────────────────────────────────

describe('POST /api/env-vars', () => {
  it('returns 401 when org context is missing', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/env-vars', env, json({ scope: 'org', key: 'K', value: 'v' }));
    expect(res.status).toBe(401);
    expect(mockSetEnvVar).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON body', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars', env, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(mockSetEnvVar).not.toHaveBeenCalled();
  });

  it('returns 400 (VALIDATION_ERROR) when scope is missing/invalid', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars', env, json({ key: 'K', value: 'v' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/scope/);
    expect(mockSetEnvVar).not.toHaveBeenCalled();
  });

  it('hands the plaintext to setEnvVar (encryption-at-rest) and returns ONLY the masked record', async () => {
    mockSetEnvVar.mockResolvedValue(maskedRecord({ key: 'API_TOKEN' }));
    const env = makeEnv();
    const res = await req(
      makeApp(AUTH),
      '/api/env-vars',
      env,
      json({ scope: 'org', key: 'API_TOKEN', value: 'super-secret-value', isSecret: true }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { var: Record<string, unknown> };

    // The plaintext is delivered to the service layer (which AES-GCM encrypts at rest).
    expect(mockSetEnvVar).toHaveBeenCalledTimes(1);
    const args = mockSetEnvVar.mock.calls[0][1] as { orgId: string; value: string; createdBy: string };
    expect(args.orgId).toBe('org-1');
    expect(args.value).toBe('super-secret-value');
    expect(args.createdBy).toBe('user-1');

    // The response carries only the masked view — plaintext NEVER round-trips back out.
    expect(body.var.value_masked).toBe('••••cret');
    expect(body.var).not.toHaveProperty('value');
    expect(JSON.stringify(body)).not.toMatch(/super-secret-value/);

    // Audit trail records the upsert.
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({
      org_id: 'org-1',
      actor_id: 'user-1',
      action: 'env_var.upsert',
    });
  });

  it('returns 400 when the service rejects the args (e.g. siteId required for scope=site)', async () => {
    mockSetEnvVar.mockRejectedValue(new Error('siteId required when scope=site'));
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars', env, json({ scope: 'site', key: 'K', value: 'v' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/siteId required/);
  });
});

// ─── PATCH /api/env-vars/:id ─────────────────────────────────────────────────────

describe('PATCH /api/env-vars/:id', () => {
  function existingRow(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'ev-1',
      org_id: 'org-1',
      scope: 'org',
      site_id: null,
      mcp_provider: null,
      endpoint_id: null,
      agent_id: null,
      key: 'API_TOKEN',
      value_encrypted: 'ciphertext-blob',
      description: 'orig',
      is_secret: 1,
      exposed_to_ai: 1,
      ...over,
    };
  }

  it('returns 401 when org context is missing', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/env-vars/ev-1', env, { ...json({ value: 'x' }), method: 'PATCH' });
    expect(res.status).toBe(401);
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON body', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/ev-1', env, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 404 (org-scoped non-leak) when no row matches in the caller org', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/other-org-id', env, {
      ...json({ value: 'x' }),
      method: 'PATCH',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    // Org scoping: the fetch is bound by both id AND org_id.
    expect(mockDbQueryOne.mock.calls[0][2]).toEqual(['other-org-id', 'org-1']);
    expect(mockSetEnvVar).not.toHaveBeenCalled();
  });

  it('updates with an explicit new value (re-encrypted at rest) without decrypting', async () => {
    mockDbQueryOne.mockResolvedValue(existingRow());
    mockSetEnvVar.mockResolvedValue(maskedRecord({ key: 'API_TOKEN' }));
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/ev-1', env, {
      ...json({ value: 'rotated-secret', exposedToAi: false }),
      method: 'PATCH',
    });
    expect(res.status).toBe(200);
    // New value supplied → no decrypt round-trip needed.
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(mockSetEnvVar).toHaveBeenCalledTimes(1);
    const args = mockSetEnvVar.mock.calls[0][1] as { value: string; exposedToAi: boolean; key: string };
    expect(args.value).toBe('rotated-secret');
    expect(args.exposedToAi).toBe(false);
    expect(args.key).toBe('API_TOKEN');
    // Response stays masked.
    const body = (await res.json()) as { var: Record<string, unknown> };
    expect(body.var).not.toHaveProperty('value');
  });

  it('decrypts the existing value and re-sets when no new value is provided (flag-only patch)', async () => {
    mockDbQueryOne.mockResolvedValue(existingRow());
    mockSetEnvVar.mockResolvedValue(maskedRecord());
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/ev-1', env, {
      ...json({ description: 'updated label' }),
      method: 'PATCH',
    });
    expect(res.status).toBe(200);
    // Value omitted → existing ciphertext is decrypted then re-set, preserving the secret.
    expect(mockDecrypt).toHaveBeenCalledWith(env, 'ciphertext-blob');
    const args = mockSetEnvVar.mock.calls[0][1] as { value: string; description: string };
    expect(args.value).toBe('dec(ciphertext-blob)');
    expect(args.description).toBe('updated label');
  });

  it('returns 500 when decrypting the existing value fails', async () => {
    mockDbQueryOne.mockResolvedValue(existingRow());
    mockDecrypt.mockRejectedValue(new Error('bad key'));
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/ev-1', env, {
      ...json({ description: 'x' }),
      method: 'PATCH',
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toMatch(/decrypt failed/);
    expect(mockSetEnvVar).not.toHaveBeenCalled();
  });
});

// ─── DELETE /api/env-vars/:id ────────────────────────────────────────────────────

describe('DELETE /api/env-vars/:id', () => {
  it('returns 401 when org context is missing', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/env-vars/ev-1', env, { method: 'DELETE' });
    expect(res.status).toBe(401);
    expect(mockDeleteEnvVar).not.toHaveBeenCalled();
  });

  it('returns 404 (org-scoped non-leak) when the row is absent in the caller org', async () => {
    mockDeleteEnvVar.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/ev-9', env, { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    // Org scoping: org_id is bound on the soft-delete.
    expect(mockDeleteEnvVar).toHaveBeenCalledWith(env, 'org-1', 'ev-9');
  });

  it('soft-deletes the row, audit-logs, and returns deleted:true', async () => {
    mockDeleteEnvVar.mockResolvedValue(true);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/ev-1', env, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({
      org_id: 'org-1',
      action: 'env_var.delete',
      target_id: 'ev-1',
    });
  });

  it('returns 500 when the delete service throws', async () => {
    mockDeleteEnvVar.mockRejectedValue(new Error('D1 locked'));
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/ev-1', env, { method: 'DELETE' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ─── POST /api/env-vars/import ───────────────────────────────────────────────────

describe('POST /api/env-vars/import', () => {
  it('returns 401 when org context is missing', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/env-vars/import', env, json({ scope: 'org', dotenv: 'A=1' }));
    expect(res.status).toBe(401);
    expect(mockSetEnvVar).not.toHaveBeenCalled();
  });

  it('returns 400 when scope is invalid', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/import', env, json({ dotenv: 'A=1' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when the dotenv blob is missing', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/import', env, json({ scope: 'org' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/dotenv/);
  });

  it('returns {imported:0} no-op for an all-comment / empty dotenv blob', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/import', env, json({ scope: 'org', dotenv: '# only a comment\n\n' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: number; failed: number };
    expect(body.imported).toBe(0);
    expect(mockSetEnvVar).not.toHaveBeenCalled();
  });

  it('returns 413 when the dotenv blob exceeds the import cap', async () => {
    const lines = Array.from({ length: 101 }, (_, i) => `K_${i}=v${i}`).join('\n');
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/import', env, json({ scope: 'org', dotenv: lines }));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(mockSetEnvVar).not.toHaveBeenCalled();
  });

  it('imports each pair through setEnvVar (encrypt path) and accounts for partial failures', async () => {
    // First key encrypts+stores fine; second throws → counted as failed.
    mockSetEnvVar
      .mockResolvedValueOnce(maskedRecord({ key: 'TOKEN_A' }))
      .mockRejectedValueOnce(new Error('bad key name'));
    const env = makeEnv();
    const res = await req(
      makeApp(AUTH),
      '/api/env-vars/import',
      env,
      json({ scope: 'org', dotenv: 'TOKEN_A="alpha-secret"\n2BAD=beta' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: number; failed: number; errors: Array<{ key: string }> };
    expect(body.imported).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.errors[0].key).toBe('2BAD');

    // Each pair's PLAINTEXT was handed to the encrypt-at-rest service layer.
    expect(mockSetEnvVar).toHaveBeenCalledTimes(2);
    const firstArgs = mockSetEnvVar.mock.calls[0][1] as { key: string; value: string; orgId: string };
    expect(firstArgs.key).toBe('TOKEN_A');
    expect(firstArgs.value).toBe('alpha-secret'); // quotes stripped by parseDotenv
    expect(firstArgs.orgId).toBe('org-1');

    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({ action: 'env_var.import' });
  });
});

// ─── GET /api/env-vars/export ────────────────────────────────────────────────────

describe('GET /api/env-vars/export', () => {
  it('returns 401 when org context is missing', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/env-vars/export', env);
    expect(res.status).toBe(401);
    expect(mockListEnvVars).not.toHaveBeenCalled();
  });

  it('returns 403 (non-leak) when a non-owner requests a plaintext export', async () => {
    // Membership lookup returns a non-owner role.
    mockDbQueryOne.mockResolvedValue({ role: 'member' });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/export?include_values=1', env);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    // Plaintext is gated: the unmask listing is never reached for a non-owner.
    expect(mockListEnvVars).not.toHaveBeenCalled();
  });

  it('produces a MASKED dotenv export by default (no plaintext, no unmask request)', async () => {
    mockListEnvVars.mockResolvedValue([
      maskedRecord({ key: 'API_TOKEN', value_masked: '••••cret', exposed_to_ai: true }),
    ]);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/export', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).toMatch(/API_TOKEN=/);
    expect(text).toMatch(/••••cret/);
    expect(text).toMatch(/include_values=0 \(values masked\)/);
    // Default export must NOT ask the service to unmask.
    const opts = mockListEnvVars.mock.calls[0][2] as { unmask?: boolean };
    expect(opts.unmask).toBe(false);
    // Membership check is skipped for a masked export.
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('produces a plaintext dotenv export for an org owner', async () => {
    mockDbQueryOne.mockResolvedValue({ role: 'owner' });
    mockListEnvVars.mockResolvedValue([
      maskedRecord({ key: 'API_TOKEN', value: 'plain-token-value', value_masked: '••••alue' }),
    ]);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/env-vars/export?include_values=1', env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/include_values=1 \(plaintext\)/);
    expect(text).toMatch(/plain-token-value/);
    // Owner gate honored: unmask requested only after the owner check passed.
    const opts = mockListEnvVars.mock.calls[0][2] as { unmask?: boolean };
    expect(opts.unmask).toBe(true);
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({ action: 'env_var.export' });
  });
});
