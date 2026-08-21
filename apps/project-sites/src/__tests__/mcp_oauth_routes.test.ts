/**
 * Route coverage for the MCP OAuth connect/callback/paste layer
 * (`src/routes/mcp_oauth.ts`, convergence r42).
 *
 * This is a SECURITY-SENSITIVE surface: it builds OAuth authorize URLs with a
 * one-shot PKCE `state`, exchanges authorization codes for tokens, and persists
 * those tokens ENCRYPTED-AT-REST into `mcp_connections`. The tests exercise each
 * handler end-to-end through the real Hono app, mocking only the boundaries:
 *   - `mcp_client` provider adapters (`getAdapter` → `authorizeUrl`/`exchangeCode`)
 *   - `ai_crypto` (`encrypt`) so we can assert the access/refresh tokens are
 *     handed to the AES-GCM helper before they ever touch D1
 *   - D1 (`DB`) via a SQL-keyword-dispatching mock that records every bound stmt
 *   - `audit.js` (`writeAuditLog`)
 *
 * Coverage:
 *   - connect: 401 (no auth), 404 (unknown provider), 400 (missing site_id),
 *     302 authorize redirect + PKCE state persisted, 501 oauth_not_configured,
 *     paste-key spec for paste-only providers (Resend).
 *   - callback: 404 (unknown provider), 400 (missing code/state), 400 (invalid
 *     state / CSRF), 502 (upstream exchange failure), 200-class success
 *     (code exchange → token encryption-at-rest → upsert → state delete → audit
 *     → redirect with ?connected), and refresh-token encryption.
 *   - paste: 401 (no auth), 400 (missing api_key), 400 (missing site_id),
 *     success (encrypt + upsert + audit), state-derived site scoping.
 *   - connections: 401 (no auth), org scoping, NEVER selects encrypted tokens.
 */

jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/ai_crypto.js', () => ({
  encrypt: jest.fn(async (_env: unknown, plaintext: string) => `enc(${plaintext})`),
}));

jest.mock('../services/mcp_client.js', () => ({
  getAdapter: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { mcpOauth } from '../routes/mcp_oauth.js';
import { getAdapter } from '../services/mcp_client.js';
import { encrypt } from '../services/ai_crypto.js';
import { writeAuditLog } from '../services/audit.js';

const mockGetAdapter = getAdapter as unknown as jest.Mock;
const mockEncrypt = encrypt as unknown as jest.Mock;
const mockWriteAuditLog = writeAuditLog as unknown as jest.Mock;

// ─── Boundary mocks ──────────────────────────────────────────────────────────

interface BoundStatement {
  sql: string;
  params: unknown[];
}

/**
 * D1 mock dispatching by SQL keyword. `firstRow` answers the `mcp_oauth_states`
 * lookup (`.first()`), `allRows` answers the connections list (`.all()`); every
 * INSERT/DELETE just records its bound params for assertion.
 */
function makeDb(
  opts: {
    firstRow?: Record<string, unknown> | null;
    allRows?: Array<Record<string, unknown>>;
    // Whether the caller's org owns the target site (gates the IDOR ownership
    // check). The canonical `assertSiteOwned` runs `SELECT org_id FROM sites
    // WHERE id = ? AND deleted_at IS NULL` and compares `row.org_id === orgId`
    // in code — so an owned site returns a row whose `org_id` equals the
    // caller's org (`ownerOrgId`, default 'org-1' = AUTH.orgId); not-owned
    // returns null (missing/foreign → 404, never leak existence). Default true.
    ownsSite?: boolean;
    ownerOrgId?: string;
  } = {},
) {
  const ownsSite = opts.ownsSite ?? true;
  const ownerOrgId = opts.ownerOrgId ?? 'org-1';
  const statements: BoundStatement[] = [];
  const prepare = jest.fn((sql: string) => {
    const bind = jest.fn((...params: unknown[]) => {
      statements.push({ sql, params });
      return {
        // `.first()` answers the raw-prepare state lookups (mcp_oauth_states).
        first: jest.fn(async () => opts.firstRow ?? null),
        run: jest.fn(async () => ({ success: true, meta: {} })),
        // `.all()` answers both the connections list AND the canonical
        // `assertSiteOwned` ownership probe (it runs via dbQuery → `.all()`).
        all: jest.fn(async () => {
          if (/FROM sites\b/i.test(sql)) {
            return { results: ownsSite ? [{ org_id: ownerOrgId }] : [] };
          }
          return { results: opts.allRows ?? [] };
        }),
      };
    });
    return { bind };
  });
  return { prepare, _statements: statements } as unknown as D1Database & {
    prepare: jest.Mock;
    _statements: BoundStatement[];
  };
}

function makeAdapter(
  over: Partial<{
    authorizeUrl: jest.Mock;
    exchangeCode: jest.Mock;
  }> = {},
) {
  return {
    provider: 'github',
    authorizeUrl:
      over.authorizeUrl ?? jest.fn(() => 'https://github.com/login/oauth/authorize?state=abc'),
    exchangeCode:
      over.exchangeCode ?? jest.fn(async () => ({ access_token: 'gho_secret', expires_in: 3600 })),
    tools: jest.fn(() => []),
    execute: jest.fn(async () => ({ ok: true })),
  };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: makeDb(),
    MCP_ENCRYPTION_KEY: 'a'.repeat(44),
    // GITHUB_OAUTH_CLIENT_ID present so isOauthConfigured() passes by default.
    GITHUB_OAUTH_CLIENT_ID: 'gh-client-id',
    ...overrides,
  } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', mcpOauth);
  return app;
}

/** Minimal ExecutionContext so the handler's `waitUntil(...)` audit call works. */
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

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAdapter.mockReturnValue(makeAdapter());
});

// ─── connect ──────────────────────────────────────────────────────────────────

describe('GET /api/mcp/:provider/connect', () => {
  it('returns 401 when org/user context is missing', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/mcp/github/connect?site_id=s1', env);
    expect(res.status).toBe(401);
    // Must short-circuit before any adapter/D1 work.
    expect((env.DB as unknown as { prepare: jest.Mock }).prepare).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown provider (no adapter)', async () => {
    mockGetAdapter.mockReturnValue(undefined);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/mcp/bogus/connect?site_id=s1', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe('unknown provider');
  });

  it('returns 400 when site_id is missing', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/mcp/github/connect', env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe('site_id required');
  });

  it('returns 501 oauth_not_configured when the provider has OAuth but no client_id', async () => {
    // No GITHUB_OAUTH_CLIENT_ID / GITHUB_CLIENT_ID set → isOauthConfigured() false.
    const env = makeEnv({ GITHUB_OAUTH_CLIENT_ID: '' });
    const res = await req(makeApp(AUTH), '/api/mcp/github/connect?site_id=s1', env);
    expect(res.status).toBe(501);
    const json = (await res.json()) as { error: string; provider: string };
    expect(json.error).toBe('oauth_not_configured');
    expect(json.provider).toBe('github');
    // No PKCE state should be persisted for an unconfigured provider.
    expect((env.DB as unknown as { _statements: BoundStatement[] })._statements).toHaveLength(0);
  });

  it('returns the authorize URL as JSON and persists a one-shot PKCE state row', async () => {
    const authorizeUrl = jest.fn(() => 'https://github.com/login/oauth/authorize?x=1');
    mockGetAdapter.mockReturnValue(makeAdapter({ authorizeUrl }));
    const env = makeEnv();
    const res = await req(
      makeApp(AUTH),
      '/api/mcp/github/connect?site_id=s1&return_url=/admin/mcp',
      env,
    );
    // JSON, NOT a 302 — the route is bearer-gated, so the admin fetches it with
    // the bearer then navigates the top window itself (the "auth required" fix).
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { mode: string; authorize_url: string } };
    expect(body.data.mode).toBe('oauth');
    expect(body.data.authorize_url).toBe('https://github.com/login/oauth/authorize?x=1');

    const stmts = (env.DB as unknown as { _statements: BoundStatement[] })._statements;
    const insert = stmts.find((s) => /INSERT INTO mcp_oauth_states/i.test(s.sql));
    expect(insert).toBeDefined();
    // params: state, org_id, site_id, provider, code_verifier, return_url
    const [state, orgId, siteId, provider, codeVerifier, returnUrl] = insert!.params as string[];
    expect(typeof state).toBe('string');
    expect(state.length).toBeGreaterThan(16);
    expect(orgId).toBe('org-1');
    expect(siteId).toBe('s1');
    expect(provider).toBe('github');
    expect(typeof codeVerifier).toBe('string');
    expect(codeVerifier.length).toBeGreaterThan(16);
    expect(returnUrl).toBe('/admin/mcp');

    // The adapter received the same state + verifier we persisted (PKCE binding).
    expect(authorizeUrl).toHaveBeenCalledTimes(1);
    const opts = authorizeUrl.mock.calls[0][1] as { state: string; codeVerifier: string };
    expect(opts.state).toBe(state);
    expect(opts.codeVerifier).toBe(codeVerifier);
  });

  it('sanitizes a malicious return_url to the fallback (open-redirect defense)', async () => {
    const authorizeUrl = jest.fn(() => 'https://github.com/login/oauth/authorize?x=1');
    mockGetAdapter.mockReturnValue(makeAdapter({ authorizeUrl }));
    const env = makeEnv({ DB: makeDb() });
    // `@evil.com` → callback would compose https://projectsites.dev@evil.com (host evil.com).
    await req(makeApp(AUTH), '/api/mcp/github/connect?site_id=s1&return_url=@evil.com', env);
    const stmts = (env.DB as unknown as { _statements: BoundStatement[] })._statements;
    const insert = stmts.find((s) => /INSERT INTO mcp_oauth_states/i.test(s.sql));
    const returnUrl = (insert!.params as string[])[5];
    expect(returnUrl).toBe('/admin/mcp'); // NOT '@evil.com'
  });

  it('returns a paste-key spec when the adapter signals __paste_key__ (Resend)', async () => {
    const authorizeUrl = jest.fn(() => '__paste_key__');
    mockGetAdapter.mockReturnValue({ ...makeAdapter({ authorizeUrl }), provider: 'resend' });
    // Resend is not in OAUTH_CLIENT_ID_ENV → isOauthConfigured() true → reaches adapter.
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/mcp/resend/connect?site_id=s1', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        mode: string;
        provider: string;
        state: string;
        post_to: string;
        instructions: string;
      };
    };
    expect(json.data.mode).toBe('paste_key');
    expect(json.data.provider).toBe('resend');
    expect(json.data.post_to).toContain('/api/mcp/resend/paste?state=');
    expect(json.data.instructions).toMatch(/Resend API key/i);
  });
});

// ─── callback ──────────────────────────────────────────────────────────────────

describe('GET /api/mcp/:provider/callback', () => {
  it('returns 404 for an unknown provider', async () => {
    mockGetAdapter.mockReturnValue(undefined);
    const env = makeEnv();
    const res = await req(makeApp(), '/api/mcp/bogus/callback?code=c&state=s', env);
    expect(res.status).toBe(404);
  });

  it('returns 400 when code or state is missing', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/mcp/github/callback?code=c', env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe('code + state required');
  });

  it('returns 400 (CSRF reject) when the state row is not found', async () => {
    const env = makeEnv({ DB: makeDb({ firstRow: null }) });
    const res = await req(makeApp(), '/api/mcp/github/callback?code=c&state=forged', env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe('invalid or expired state');
    // No token should be encrypted for a forged/unknown state.
    expect(mockEncrypt).not.toHaveBeenCalled();
  });

  it('connect 404s when the site belongs to another org (IDOR guard)', async () => {
    const env = makeEnv({ DB: makeDb({ ownsSite: false }) });
    const res = await req(makeApp(AUTH), '/api/mcp/github/connect?site_id=foreign', env);
    expect(res.status).toBe(404);
    // No PKCE state row was persisted for an unowned site.
    const stmts = (env.DB as unknown as { _statements: BoundStatement[] })._statements;
    expect(stmts.some((s) => /INSERT INTO mcp_oauth_states/i.test(s.sql))).toBe(false);
  });

  it('returns 502 when the upstream token exchange throws', async () => {
    const exchangeCode = jest.fn(async () => {
      throw new Error('github 401 bad_verification_code');
    });
    mockGetAdapter.mockReturnValue(makeAdapter({ exchangeCode }));
    const env = makeEnv({
      DB: makeDb({
        firstRow: { org_id: 'org-1', site_id: 's1', code_verifier: 'v', return_url: '/admin/mcp' },
      }),
    });
    const res = await req(makeApp(), '/api/mcp/github/callback?code=bad&state=ok', env);
    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: { code?: string; message: string } };
    // Client gets a GENERIC message; the raw upstream 'bad_verification_code' body
    // (adapters bake `${await res.text()}` in — airtable/vercel) is logged
    // server-side only, never echoed to the caller (info-disclosure hardening).
    expect(json.error.message).not.toMatch(/bad_verification_code|github 401/);
    expect(json.error.message).toBe('Connection failed — please try again.');
    expect(json.error.code).toBe('OAUTH_EXCHANGE_FAILED');
    expect(mockEncrypt).not.toHaveBeenCalled();
  });

  it('exchanges the code, encrypts tokens at rest, upserts, deletes state, audits, and returns a self-closing page', async () => {
    const exchangeCode = jest.fn(async () => ({
      access_token: 'gho_live_token',
      refresh_token: 'ghr_refresh_token',
      expires_in: 3600,
      metadata: { login: 'octocat' },
    }));
    mockGetAdapter.mockReturnValue(makeAdapter({ exchangeCode }));
    const db = makeDb({
      firstRow: {
        org_id: 'org-1',
        site_id: 's1',
        code_verifier: 'verifier-x',
        return_url: '/admin/mcp',
      },
    });
    const env = makeEnv({ DB: db });
    const res = await req(
      makeApp({ requestId: 'req-1' }),
      '/api/mcp/github/callback?code=auth_code&state=state_x',
      env,
      {
        redirect: 'manual',
      },
    );

    // Returns an HTML page that messages the opener + self-closes — NOT a 302
    // that would load the dashboard SPA inside the OAuth popup window.
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain('ps:mcp:connected');
    expect(body).toContain('"github"');
    expect(body).toContain('https://projectsites.dev/admin/mcp?connected=github');

    // PKCE: the persisted code_verifier was sent to the exchange.
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    const exOpts = exchangeCode.mock.calls[0][1] as {
      code: string;
      codeVerifier: string;
      redirectUri: string;
    };
    expect(exOpts.code).toBe('auth_code');
    expect(exOpts.codeVerifier).toBe('verifier-x');
    expect(exOpts.redirectUri).toBe('https://projectsites.dev/api/mcp/github/callback');

    // Encryption-at-rest: BOTH access + refresh tokens go through encrypt().
    expect(mockEncrypt).toHaveBeenCalledTimes(2);
    expect(mockEncrypt.mock.calls.map((c) => c[1])).toEqual(
      expect.arrayContaining(['gho_live_token', 'ghr_refresh_token']),
    );

    const stmts = db._statements;
    const upsert = stmts.find((s) => /INSERT INTO mcp_connections/i.test(s.sql));
    expect(upsert).toBeDefined();
    // The CIPHERTEXT (not the plaintext token) is what lands in D1.
    expect(upsert!.params).toContain('enc(gho_live_token)');
    expect(upsert!.params).toContain('enc(ghr_refresh_token)');
    // Cleartext token MUST NEVER appear in any bound D1 param.
    const allParams = stmts.flatMap((s) => s.params);
    expect(allParams).not.toContain('gho_live_token');
    expect(allParams).not.toContain('ghr_refresh_token');

    // One-shot state is consumed (deleted) after a successful exchange.
    expect(stmts.some((s) => /DELETE FROM mcp_oauth_states/i.test(s.sql))).toBe(true);

    // Audit trail records the connection.
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({
      org_id: 'org-1',
      action: 'mcp.connected',
      target_type: 'mcp_connection',
    });
  });

  it('encrypts only the access token when no refresh token is returned', async () => {
    const exchangeCode = jest.fn(async () => ({ access_token: 'only_access' }));
    mockGetAdapter.mockReturnValue(makeAdapter({ exchangeCode }));
    const env = makeEnv({
      DB: makeDb({
        firstRow: { org_id: 'org-1', site_id: 's1', code_verifier: 'v', return_url: '/admin/mcp' },
      }),
    });
    const res = await req(makeApp(), '/api/mcp/github/callback?code=c&state=s', env, {
      redirect: 'manual',
    });
    expect(res.status).toBe(200);
    expect(mockEncrypt).toHaveBeenCalledTimes(1);
    expect(mockEncrypt.mock.calls[0][1]).toBe('only_access');
  });
});

// ─── paste ──────────────────────────────────────────────────────────────────

describe('POST /api/mcp/:provider/paste', () => {
  function postPaste(env: Env, path: string, body: unknown, vars: Partial<Variables> = AUTH) {
    return req(makeApp(vars), path, env, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns 401 when org context is missing', async () => {
    const env = makeEnv();
    const res = await postPaste(env, '/api/mcp/resend/paste?site_id=s1', { api_key: 're_x' }, {});
    expect(res.status).toBe(401);
    expect(mockEncrypt).not.toHaveBeenCalled();
  });

  it('returns 400 when api_key is missing', async () => {
    const env = makeEnv();
    const res = await postPaste(env, '/api/mcp/resend/paste?site_id=s1', {});
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe('api_key required');
  });

  it('404s on a site_id (no state) the caller org does not own (IDOR guard)', async () => {
    const env = makeEnv({ DB: makeDb({ ownsSite: false }) });
    const res = await postPaste(env, '/api/mcp/resend/paste?site_id=foreign', { api_key: 're_x' });
    expect(res.status).toBe(404);
    expect(mockEncrypt).not.toHaveBeenCalled();
  });

  it('returns 400 (not a 500) on a malformed JSON body — never reaches encrypt', async () => {
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/mcp/resend/paste?site_id=s1', env, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(mockEncrypt).not.toHaveBeenCalled();
  });

  it('returns 400 when api_key is a non-string (boundary type check)', async () => {
    const env = makeEnv();
    const res = await postPaste(env, '/api/mcp/resend/paste?site_id=s1', { api_key: 123 });
    expect(res.status).toBe(400);
    expect(mockEncrypt).not.toHaveBeenCalled();
  });

  it('returns 400 when site_id cannot be resolved (no state, no query)', async () => {
    const env = makeEnv();
    const res = await postPaste(env, '/api/mcp/resend/paste', { api_key: 're_x' });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe('site_id required');
  });

  it('encrypts the pasted key, upserts the connection, and audit-logs (site_id from query)', async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db });
    const res = await postPaste(env, '/api/mcp/resend/paste?site_id=s1', {
      api_key: 're_live_key',
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { connected: boolean } };
    expect(json.data.connected).toBe(true);

    expect(mockEncrypt).toHaveBeenCalledWith(env, 're_live_key');
    const upsert = db._statements.find((s) => /INSERT INTO mcp_connections/i.test(s.sql));
    expect(upsert).toBeDefined();
    expect(upsert!.params).toContain('enc(re_live_key)');
    // Plaintext key must never be bound directly.
    expect(db._statements.flatMap((s) => s.params)).not.toContain('re_live_key');

    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({
      org_id: 'org-1',
      action: 'mcp.connected',
      metadata_json: expect.objectContaining({ flow: 'paste_key' }),
    });
  });

  it('resolves site_id from the org-scoped state row when state is supplied', async () => {
    const db = makeDb({ firstRow: { site_id: 'site-from-state' } });
    const env = makeEnv({ DB: db });
    const res = await postPaste(env, '/api/mcp/resend/paste?state=st1', { api_key: 're_x' });
    expect(res.status).toBe(200);
    // State lookup is org-scoped (org_id is the 2nd bound param).
    const lookup = db._statements.find((s) => /SELECT site_id FROM mcp_oauth_states/i.test(s.sql));
    expect(lookup).toBeDefined();
    expect(lookup!.params).toEqual(['st1', 'org-1']);
    const upsert = db._statements.find((s) => /INSERT INTO mcp_connections/i.test(s.sql));
    expect(upsert!.params).toContain('site-from-state');
    // The consumed state row is deleted.
    expect(db._statements.some((s) => /DELETE FROM mcp_oauth_states/i.test(s.sql))).toBe(true);
  });
});

// ─── connections list ──────────────────────────────────────────────────────────

describe('GET /api/mcp/connections', () => {
  it('returns 401 when org context is missing', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/mcp/connections', env);
    expect(res.status).toBe(401);
  });

  it('lists the org connections and NEVER selects encrypted token columns', async () => {
    const db = makeDb({
      allRows: [
        {
          id: 'c1',
          site_id: 's1',
          provider: 'github',
          display_name: 'github connection',
          status: 'active',
          scopes_json: '["repo"]',
        },
      ],
    });
    const env = makeEnv({ DB: db });
    const res = await req(makeApp(AUTH), '/api/mcp/connections', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ provider: string; scopes: string[] }> };
    expect(json.data).toHaveLength(1);
    expect(json.data[0].provider).toBe('github');
    expect(json.data[0].scopes).toEqual(['repo']);

    // The SELECT must be org-scoped and must NOT pull access/refresh ciphertext.
    const select = db._statements.find((s) => /FROM mcp_connections/i.test(s.sql));
    expect(select).toBeDefined();
    expect(select!.params).toEqual(['org-1']);
    expect(select!.sql).not.toMatch(/access_token_encrypted/i);
    expect(select!.sql).not.toMatch(/refresh_token_encrypted/i);
  });

  // Scope filters: env-vars-attachment + voice/mcps both fetch connections
  // "scoped to this site" but the endpoint used to IGNORE the site param → both
  // surfaces showed EVERY org connection. These assert the SELECT is now scoped.
  it('honors the ?site_id filter (env-vars-attachment) — scopes the SELECT to that site', async () => {
    const db = makeDb({ allRows: [] });
    const env = makeEnv({ DB: db });
    const res = await req(makeApp(AUTH), '/api/mcp/connections?site_id=site-9', env);
    expect(res.status).toBe(200);
    const select = db._statements.find((s) => /FROM mcp_connections/i.test(s.sql));
    expect(select).toBeDefined();
    expect(select!.sql).toMatch(/site_id = \?/i);
    expect(select!.params).toEqual(['org-1', 'site-9']);
  });

  it('honors the ?siteId filter too (voice/mcps sends camelCase)', async () => {
    const db = makeDb({ allRows: [] });
    const env = makeEnv({ DB: db });
    const res = await req(makeApp(AUTH), '/api/mcp/connections?siteId=site-9', env);
    expect(res.status).toBe(200);
    const select = db._statements.find((s) => /FROM mcp_connections/i.test(s.sql));
    expect(select!.params).toEqual(['org-1', 'site-9']);
  });

  it('honors the ?provider filter, AND-combined with the org scope', async () => {
    const db = makeDb({ allRows: [] });
    const env = makeEnv({ DB: db });
    const res = await req(makeApp(AUTH), '/api/mcp/connections?provider=resend', env);
    expect(res.status).toBe(200);
    const select = db._statements.find((s) => /FROM mcp_connections/i.test(s.sql));
    expect(select!.sql).toMatch(/provider = \?/i);
    expect(select!.params).toEqual(['org-1', 'resend']);
  });

  it('stays org-wide when no scope param is present (original contract preserved)', async () => {
    const db = makeDb({ allRows: [] });
    const env = makeEnv({ DB: db });
    const res = await req(makeApp(AUTH), '/api/mcp/connections', env);
    expect(res.status).toBe(200);
    const select = db._statements.find((s) => /FROM mcp_connections/i.test(s.sql));
    expect(select!.params).toEqual(['org-1']);
    expect(select!.sql).not.toMatch(/site_id = \?/i);
  });
});

/**
 * Vercel Marketplace callback — IDOR hardening (iter 246, security-review wave).
 *
 * The marketplace install flow is UNAUTHENTICATED (no org/user context — Vercel
 * initiates it) and previously keyed the credential write on the CLIENT-supplied
 * `configurationId` (`site_id = 'vercel:${configurationId}'`) with
 * `ON CONFLICT ... DO UPDATE`. Any Vercel user could install the public
 * integration, rewrite `configurationId` to a victim's ID, and clobber that
 * victim's `mcp_connections` row with their own token — the victim's site then
 * executes Vercel API calls as the attacker's account (CWE-639).
 *
 * Fix: the exchange response carries the AUTHORITATIVE identity
 * (`installation_id`, `team_id`, `user_id`) — the row key must derive from
 * THAT, and a client-supplied `configurationId` must MATCH the installation_id
 * (or be absent) before any write happens. These tests lock both branches.
 */
describe('GET /api/mcp/vercel/callback (marketplace install — IDOR-hardened)', () => {
  const vercelAdapter = (exchangeResult: unknown) =>
    makeAdapter({ exchangeCode: jest.fn(async () => exchangeResult) });

  it('accepts a MATCHING client configurationId and keys the row on the exchange installation_id', async () => {
    const exchangeCode = jest.fn(async () => ({
      access_token: 'vx_token',
      metadata: { installation_id: 'inst-authoritative', team_id: 'team-a', user_id: 'u1' },
    }));
    mockGetAdapter.mockReturnValue(makeAdapter({ exchangeCode }));
    const db = makeDb({});
    const env = makeEnv({ DB: db });
    const res = await req(
      makeApp(),
      '/api/mcp/vercel/callback?code=vc&configurationId=inst-authoritative',
      env,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(200);
    const stmts = db._statements;
    const upsert = stmts.find((s) => /INSERT INTO mcp_connections/i.test(s.sql));
    expect(upsert).toBeDefined();
    expect(upsert!.params).toContain('vercel:inst-authoritative');
  });

  it('rejects when the client configurationId does NOT match the exchange installation_id (clobber attempt)', async () => {
    const exchangeCode = jest.fn(async () => ({
      access_token: 'vx_token',
      metadata: { installation_id: 'inst-authoritative', team_id: null, user_id: 'u1' },
    }));
    mockGetAdapter.mockReturnValue(makeAdapter({ exchangeCode }));
    const db = makeDb({});
    const env = makeEnv({ DB: db });
    const res = await req(
      makeApp(),
      '/api/mcp/vercel/callback?code=vc&configurationId=victims-id',
      env,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(403);
    const stmts = db._statements;
    expect(stmts.some((s) => /INSERT INTO mcp_connections/i.test(s.sql))).toBe(false);
    expect(mockEncrypt).not.toHaveBeenCalled();
  });

  it('still accepts a configurationId-less marketplace callback (keys on installation_id alone)', async () => {
    const exchangeCode = jest.fn(async () => ({
      access_token: 'vx_token',
      metadata: { installation_id: 'inst-only', team_id: null, user_id: 'u1' },
    }));
    mockGetAdapter.mockReturnValue(makeAdapter({ exchangeCode }));
    const db = makeDb({});
    const env = makeEnv({ DB: db });
    const res = await req(
      makeApp(),
      '/api/mcp/vercel/callback?code=vc',
      env,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(200);
    const stmts = db._statements;
    const upsert = stmts.find((s) => /INSERT INTO mcp_connections/i.test(s.sql));
    expect(upsert!.params).toContain('vercel:inst-only');
  });
});
