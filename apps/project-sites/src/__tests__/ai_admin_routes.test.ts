/**
 * Route coverage for the authenticated admin surface in `routes/ai_admin.ts`
 * (convergence r47 — NEW additive spec).
 *
 * `ai_admin.ts` is a 3000+ line surface; this spec locks the highest-value,
 * most security-sensitive handlers: the `need()` auth gate (401 on every
 * route), `siteOwned()` org-scoping (404 non-leak), the Team suite (invites
 * with seat-cap 409 + transfer-ownership + member list + last-owner guard +
 * invite accept), org API keys, destructive org delete (owner-only 403),
 * org security defaults, credits, site-cost rollup, audit rows, and MCP
 * connections.
 *
 * Boundaries mocked: the team-seat / billing / credits / audit services + an
 * in-memory SQL-routed D1 stub. No real APIs, no network.
 */

jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/team_seats.js', () => ({
  resolveSeatLimit: jest.fn(() => 10),
  countSeatUsage: jest.fn(async () => ({ members: 1, invites: 0, total: 1 })),
  canInviteMember: jest.fn(() => ({ allowed: true })),
  transferOwnership: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../services/billing.js', () => ({
  getOrgEntitlements: jest.fn(async () => ({ maxTeamSeats: 10 })),
}));
jest.mock('../services/credits.js', () => ({
  getBalance: jest.fn(async () => 1234),
  topupCredits: jest.fn(async () => 5000),
  CREDIT_BUNDLES: { small: { credits: 1000, price_id: 'STRIPE_PRICE_SMALL' } },
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { aiAdmin } from '../routes/ai_admin.js';
import { writeAuditLog } from '../services/audit.js';
import { canInviteMember, transferOwnership } from '../services/team_seats.js';

const mockWriteAuditLog = writeAuditLog as unknown as jest.Mock;
const mockCanInvite = canInviteMember as unknown as jest.Mock;
const mockTransfer = transferOwnership as unknown as jest.Mock;

// ─── D1 mock: route prepared statements by SQL substring ─────────────────────

type Row = Record<string, unknown>;
type Responder = { first?: Row | null; all?: Row[]; run?: unknown };

/**
 * Build a D1 stub whose `.prepare(sql)` returns a chainable
 * `.bind(...).first()/.all()/.run()`. Each rule matches the SQL via substring;
 * the FIRST matching rule wins. Unmatched reads return null/[] (so a forgotten
 * table never throws), unmatched writes resolve to a no-op.
 */
function makeDb(rules: Array<{ match: string; resp: Responder }>) {
  const prepare = jest.fn((sql: string) => {
    const rule = rules.find((r) => sql.includes(r.match));
    const resp = rule?.resp ?? {};
    const chain = {
      bind: jest.fn(() => chain),
      first: jest.fn(async () => (resp.first === undefined ? null : resp.first)),
      all: jest.fn(async () => ({ results: resp.all ?? [] })),
      run: jest.fn(async () => resp.run ?? { success: true }),
    };
    return chain;
  });
  return { prepare, batch: jest.fn(async () => []) } as unknown as D1Database;
}

/** Site row that `siteOwned()` resolves for the happy path. */
const OWNED_SITE = { match: 'FROM sites WHERE id = ?', resp: { first: { slug: 'apple', business_name: 'Apple' } } };
/** Site row that does NOT exist for the caller's org → 404 non-leak. */
const NO_SITE = { match: 'FROM sites WHERE id = ?', resp: { first: null } };

function makeEnv(db: D1Database, overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: db,
    SITES_BUCKET: {
      put: jest.fn(async () => undefined),
      get: jest.fn(async () => null),
      delete: jest.fn(async () => undefined),
    },
    ...overrides,
  } as unknown as Env;
}

function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', aiAdmin);
  return app;
}

function makeCtx(): ExecutionContext {
  return { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

function req(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  method: string,
  path: string,
  env: Env,
  body?: unknown,
) {
  return app.request(
    path,
    {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
    makeCtx(),
  );
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockCanInvite.mockReturnValue({ allowed: true });
  mockTransfer.mockResolvedValue({ ok: true });
});

// ─── Auth gate (need) — every route 401s without org+user ────────────────────

describe('ai_admin — auth gate', () => {
  it.each([
    ['GET', '/api/team'],
    ['GET', '/api/sites/s1/form-submissions'],
    ['GET', '/api/sites/s1/ai-logs'],
    ['GET', '/api/billing/credits'],
    ['GET', '/api/admin/api-keys'],
    ['GET', '/api/audit/rows'],
  ])('returns 401 for unauthenticated %s %s', async (method, path) => {
    const env = makeEnv(makeDb([]));
    const res = await req(makeApp(), method, path, env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toBe('Authentication required');
  });

  it('does not query D1 when the caller is unauthenticated', async () => {
    const db = makeDb([]);
    const env = makeEnv(db);
    await req(makeApp(), 'GET', '/api/team', env);
    expect((db.prepare as jest.Mock)).not.toHaveBeenCalled();
  });
});

// ─── Org scoping (siteOwned) — 404 non-leak ──────────────────────────────────

describe('ai_admin — site org scoping (404 non-leak)', () => {
  it('returns 404 when the site is not owned by the caller org', async () => {
    const env = makeEnv(makeDb([NO_SITE]));
    const res = await req(makeApp(AUTH), 'GET', '/api/sites/other/form-submissions', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toBe('Site not found');
  });

  it('lists form submissions with parsed fields for an owned site', async () => {
    const env = makeEnv(
      makeDb([
        OWNED_SITE,
        { match: 'FROM form_submissions', resp: { all: [{ id: 'sub1', payload: '{"email":"a@b.c"}' }] } },
      ]),
    );
    const res = await req(makeApp(AUTH), 'GET', '/api/sites/s1/form-submissions', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ fields: unknown }> };
    expect(json.data[0].fields).toEqual({ email: 'a@b.c' });
  });

  it('returns 404 for a missing single form submission on an owned site', async () => {
    const env = makeEnv(
      makeDb([OWNED_SITE, { match: 'FROM form_submissions WHERE id = ?', resp: { first: null } }]),
    );
    const res = await req(makeApp(AUTH), 'GET', '/api/sites/s1/form-submissions/missing', env);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a missing ai-log row', async () => {
    const env = makeEnv(
      makeDb([OWNED_SITE, { match: 'FROM ai_form_logs WHERE id = ?', resp: { first: null } }]),
    );
    const res = await req(makeApp(AUTH), 'GET', '/api/sites/s1/ai-logs/nope', env);
    expect(res.status).toBe(404);
  });
});

// ─── Team list ───────────────────────────────────────────────────────────────

describe('GET /api/team', () => {
  it('returns active members + pending invites for the org', async () => {
    const env = makeEnv(
      makeDb([
        { match: 'FROM memberships m JOIN users', resp: { all: [{ id: 'user-1', email: 'a@b.c', role: 'owner' }] } },
        { match: 'FROM team_invites', resp: { all: [{ id: 'inv1', email: 'x@y.z', role: 'viewer' }] } },
      ]),
    );
    const res = await req(makeApp(AUTH), 'GET', '/api/team', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { members: unknown[]; invites: unknown[] } };
    expect(json.data.members).toHaveLength(1);
    expect(json.data.invites).toHaveLength(1);
  });
});

// ─── Team invites ─────────────────────────────────────────────────────────────

describe('POST /api/team/invites', () => {
  it('returns 400 when email or role is missing', async () => {
    const env = makeEnv(makeDb([]));
    const res = await req(makeApp(AUTH), 'POST', '/api/team/invites', env, { email: 'x@y.z' });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toBe('email + role required');
  });

  it('returns 409 when the seat cap is reached', async () => {
    mockCanInvite.mockReturnValue({ allowed: false, reason: 'Seat limit reached (1/1)' });
    const env = makeEnv(makeDb([]));
    const res = await req(makeApp(AUTH), 'POST', '/api/team/invites', env, { email: 'x@y.z', role: 'viewer' });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toContain('Seat limit');
  });

  it('creates an invite (201) + writes an audit row when seats are available', async () => {
    const env = makeEnv(makeDb([{ match: 'INSERT INTO team_invites', resp: { run: { success: true } } }]));
    const res = await req(makeApp(AUTH), 'POST', '/api/team/invites', env, { email: 'x@y.z', role: 'editor' });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { id: string; token: string } };
    expect(json.data.id).toBeTruthy();
    expect(json.data.token).toBeTruthy();
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({ action: 'team.invite_sent', org_id: 'org-1' });
  });

  it('does not send an email when RESEND_API_KEY is absent', async () => {
    global.fetch = jest.fn();
    const env = makeEnv(makeDb([]));
    await req(makeApp(AUTH), 'POST', '/api/team/invites', env, { email: 'x@y.z', role: 'viewer' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/team/invites/:id', () => {
  it('revokes a pending invite + audits', async () => {
    const env = makeEnv(
      makeDb([{ match: 'FROM team_invites WHERE id = ?', resp: { first: { email: 'x@y.z', role: 'viewer' } } }]),
    );
    const res = await req(makeApp(AUTH), 'DELETE', '/api/team/invites/inv1', env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { data: { revoked: boolean } }).toEqual({ data: { revoked: true } });
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({ action: 'team.invite_revoked' });
  });
});

// ─── Transfer ownership ───────────────────────────────────────────────────────

describe('POST /api/team/transfer-ownership', () => {
  it('returns 400 when targetUserId is missing', async () => {
    const env = makeEnv(makeDb([]));
    const res = await req(makeApp(AUTH), 'POST', '/api/team/transfer-ownership', env, {});
    expect(res.status).toBe(400);
    expect((await res.json()) as { error?: { message?: string } }).toMatchObject({
      error: { message: 'targetUserId required' },
    });
  });

  it('returns 400 when the transfer policy rejects', async () => {
    mockTransfer.mockResolvedValue({ ok: false, error: 'Only the owner can transfer' });
    const env = makeEnv(makeDb([]));
    const res = await req(makeApp(AUTH), 'POST', '/api/team/transfer-ownership', env, { targetUserId: 'u2' });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error?: { message?: string } }).toMatchObject({
      error: { message: 'Only the owner can transfer' },
    });
  });

  it('transfers ownership (ok:true) + audits on success', async () => {
    const env = makeEnv(makeDb([]));
    const res = await req(makeApp(AUTH), 'POST', '/api/team/transfer-ownership', env, { targetUserId: 'u2' });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });
    expect(mockTransfer).toHaveBeenCalledWith(expect.anything(), 'org-1', 'user-1', 'u2');
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({ action: 'team.ownership_transferred' });
  });
});

// ─── Member removal (last-owner guard) ────────────────────────────────────────

describe('DELETE /api/team/members/:userId', () => {
  it('returns 409 when removing the last owner', async () => {
    const env = makeEnv(
      makeDb([
        { match: 'SELECT role FROM memberships WHERE user_id = ?', resp: { first: { role: 'owner' } } },
        { match: "role = 'owner'", resp: { first: { n: 1 } } },
      ]),
    );
    const res = await req(makeApp(AUTH), 'DELETE', '/api/team/members/owner-2', env);
    expect(res.status).toBe(409);
    expect((await res.json()) as { error?: { message?: string } }).toMatchObject({
      error: { message: expect.stringContaining('last owner') },
    });
  });

  it('removes a non-owner member (200) + audits', async () => {
    const env = makeEnv(
      makeDb([{ match: 'SELECT role FROM memberships WHERE user_id = ?', resp: { first: { role: 'editor' } } }]),
    );
    const res = await req(makeApp(AUTH), 'DELETE', '/api/team/members/u9', env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { data: { removed: boolean } }).toEqual({ data: { removed: true } });
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({ action: 'team.member_removed' });
  });

  it('allows removing an owner when more than one owner exists', async () => {
    const env = makeEnv(
      makeDb([
        { match: 'SELECT role FROM memberships WHERE user_id = ?', resp: { first: { role: 'owner' } } },
        { match: "role = 'owner'", resp: { first: { n: 2 } } },
      ]),
    );
    const res = await req(makeApp(AUTH), 'DELETE', '/api/team/members/owner-2', env);
    expect(res.status).toBe(200);
  });
});

// ─── Invite acceptance ────────────────────────────────────────────────────────

describe('POST /api/team/invites/accept', () => {
  it('returns 400 when the token is missing', async () => {
    const env = makeEnv(makeDb([]));
    const res = await req(makeApp(AUTH), 'POST', '/api/team/invites/accept', env, {});
    expect(res.status).toBe(400);
    expect((await res.json()) as { error?: { code?: string } }).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('returns 404 when no matching pending invite exists', async () => {
    const env = makeEnv(makeDb([{ match: 'FROM team_invites', resp: { first: null } }]));
    const res = await req(makeApp(AUTH), 'POST', '/api/team/invites/accept', env, { token: 'abc' });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error?: { code?: string } }).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns 410 when the invite is expired', async () => {
    const env = makeEnv(
      makeDb([
        {
          match: 'FROM team_invites',
          resp: {
            first: {
              id: 'inv1', org_id: 'org-2', email: 'x@y.z', role: 'viewer',
              expires_at: new Date(Date.now() - 1000).toISOString(),
            },
          },
        },
      ]),
    );
    const res = await req(makeApp(AUTH), 'POST', '/api/team/invites/accept', env, { token: 'abc' });
    expect(res.status).toBe(410);
    expect((await res.json()) as { error?: { code?: string } }).toMatchObject({ error: { code: 'EXPIRED' } });
  });

  it('returns 403 when the signed-in user email does not match the invite', async () => {
    const env = makeEnv(
      makeDb([
        {
          match: 'FROM team_invites',
          resp: {
            first: {
              id: 'inv1', org_id: 'org-2', email: 'invitee@y.z', role: 'viewer',
              expires_at: new Date(Date.now() + 86400_000).toISOString(),
            },
          },
        },
        { match: 'SELECT email FROM users WHERE id = ?', resp: { first: { email: 'someoneelse@y.z' } } },
      ]),
    );
    const res = await req(makeApp(AUTH), 'POST', '/api/team/invites/accept', env, { token: 'abc' });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error?: { code?: string } }).toMatchObject({ error: { code: 'WRONG_USER' } });
  });

  it('joins the org (200) when the token + email match', async () => {
    const env = makeEnv(
      makeDb([
        {
          match: 'FROM team_invites',
          resp: {
            first: {
              id: 'inv1', org_id: 'org-2', email: 'me@y.z', role: 'editor',
              expires_at: new Date(Date.now() + 86400_000).toISOString(),
            },
          },
        },
        { match: 'SELECT email FROM users WHERE id = ?', resp: { first: { email: 'me@y.z' } } },
      ]),
    );
    const res = await req(makeApp(AUTH), 'POST', '/api/team/invites/accept', env, { token: 'abc' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { joined: boolean; org_id: string; role: string } };
    expect(json.data).toMatchObject({ joined: true, org_id: 'org-2', role: 'editor' });
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({ action: 'team.invite_accepted' });
  });
});

// ─── Org API keys ─────────────────────────────────────────────────────────────

describe('org API keys', () => {
  it('lists keys with derived `active` flag and no secrets', async () => {
    const env = makeEnv(
      makeDb([
        {
          match: 'FROM api_keys WHERE org_id = ? ORDER BY',
          resp: { all: [{ id: 'k1', name: 'CI', prefix: 'psk_live_xx', scopes_json: '["read"]', revoked_at: null, expires_at: null }] },
        },
      ]),
    );
    const res = await req(makeApp(AUTH), 'GET', '/api/admin/api-keys', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ active: boolean; scopes: string[]; secret?: string }> };
    expect(json.data[0].active).toBe(true);
    expect(json.data[0].scopes).toEqual(['read']);
    expect(json.data[0].secret).toBeUndefined();
  });

  it('mints a key (201) and returns the raw secret exactly once', async () => {
    const env = makeEnv(makeDb([{ match: 'INSERT INTO api_keys', resp: { run: { success: true } } }]));
    const res = await req(makeApp(AUTH), 'POST', '/api/admin/api-keys', env, { name: 'CI key' });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { secret: string; prefix: string; name: string } };
    expect(json.data.secret).toMatch(/^psk_live_/);
    expect(json.data.prefix).toBe(json.data.secret.slice(0, 16));
    expect(json.data.name).toBe('CI key');
  });

  it('revokes a key (200)', async () => {
    const env = makeEnv(makeDb([{ match: 'UPDATE api_keys SET revoked_at', resp: { run: { success: true } } }]));
    const res = await req(makeApp(AUTH), 'DELETE', '/api/admin/api-keys/k1', env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { data: { revoked: boolean } }).toEqual({ data: { revoked: true } });
  });
});

// ─── Destructive org delete (owner-only) ──────────────────────────────────────

describe('POST /api/admin/org/delete', () => {
  it('returns 400 when the confirmation text is wrong', async () => {
    const env = makeEnv(makeDb([]));
    const res = await req(makeApp(AUTH), 'POST', '/api/admin/org/delete', env, { confirm: 'nope' });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error?: { code?: string } }).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('returns 403 when the caller is not the org owner', async () => {
    const env = makeEnv(
      makeDb([{ match: 'FROM memberships WHERE org_id = ? AND user_id = ?', resp: { first: { role: 'editor' } } }]),
    );
    const res = await req(makeApp(AUTH), 'POST', '/api/admin/org/delete', env, { confirm: 'DELETE' });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error?: { code?: string } }).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('soft-deletes the org (200) when an owner confirms', async () => {
    const db = makeDb([{ match: 'FROM memberships WHERE org_id = ? AND user_id = ?', resp: { first: { role: 'owner' } } }]);
    const env = makeEnv(db);
    const res = await req(makeApp(AUTH), 'POST', '/api/admin/org/delete', env, { confirm: 'DELETE' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { deleted: boolean; scheduled_purge_after_days: number } };
    expect(json.data).toMatchObject({ deleted: true, scheduled_purge_after_days: 30 });
    expect((db.batch as jest.Mock)).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({ action: 'org.deleted' });
  });
});

// ─── Org security defaults ────────────────────────────────────────────────────

describe('org security defaults', () => {
  it('GET returns sane defaults when no row exists', async () => {
    const env = makeEnv(makeDb([{ match: 'FROM org_security WHERE org_id = ?', resp: { first: null } }]));
    const res = await req(makeApp(AUTH), 'GET', '/api/admin/security', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { session_hours: number; require_2fa: number } };
    expect(json.data.session_hours).toBe(168);
    expect(json.data.require_2fa).toBe(0);
  });

  it('PUT clamps session_hours into the [1,720] range', async () => {
    const env = makeEnv(makeDb([{ match: 'INSERT INTO org_security', resp: { run: { success: true } } }]));
    const res = await req(makeApp(AUTH), 'PUT', '/api/admin/security', env, { session_hours: 99999, idle_minutes: 1 });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { session_hours: number; idle_minutes: number } };
    expect(json.data.session_hours).toBe(720); // clamped down
    expect(json.data.idle_minutes).toBe(5); // clamped up to min
  });
});

// ─── Credits + site costs ─────────────────────────────────────────────────────

describe('GET /api/billing/credits', () => {
  it('returns balance + bundles + ledger', async () => {
    const env = makeEnv(
      makeDb([{ match: 'FROM ai_credits_ledger', resp: { all: [{ delta: 1000, reason: 'topup' }] } }]),
    );
    const res = await req(makeApp(AUTH), 'GET', '/api/billing/credits', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { balance: number; bundles: unknown; ledger: unknown[] } };
    expect(json.data.balance).toBe(1234);
    expect(json.data.bundles).toBeTruthy();
    expect(json.data.ledger).toHaveLength(1);
  });
});

describe('GET /api/billing/site-costs', () => {
  it('rolls up per-site spend and enriches with site names', async () => {
    const env = makeEnv(
      makeDb([
        { match: 'FROM site_cost_daily', resp: { all: [{ site_id: 's1', ai_credits: 50, estimated_cost_micro_usd: 100 }] } },
        { match: 'FROM sites WHERE org_id = ? AND deleted_at', resp: { all: [{ id: 's1', slug: 'apple', business_name: 'Apple' }] } },
      ]),
    );
    const res = await req(makeApp(AUTH), 'GET', '/api/billing/site-costs', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { rows: Array<{ slug?: string; business_name?: string }> } };
    expect(json.data.rows[0]).toMatchObject({ slug: 'apple', business_name: 'Apple' });
  });
});

// ─── Audit rows ───────────────────────────────────────────────────────────────

describe('GET /api/audit/rows', () => {
  it('returns audit rows with parsed metadata', async () => {
    const env = makeEnv(
      makeDb([
        {
          match: 'FROM audit_logs WHERE org_id = ?',
          resp: { all: [{ id: 'a1', action: 'org.deleted', metadata_json: '{"k":1}' }] },
        },
      ]),
    );
    const res = await req(makeApp(AUTH), 'GET', '/api/audit/rows', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ metadata: unknown }> };
    expect(json.data[0].metadata).toEqual({ k: 1 });
  });
});

// ─── MCP connections (org-scoped read) ────────────────────────────────────────

describe('GET /api/sites/:siteId/mcp/connections', () => {
  it('returns 404 for a site not owned by the caller org', async () => {
    const env = makeEnv(makeDb([NO_SITE]));
    const res = await req(makeApp(AUTH), 'GET', '/api/sites/other/mcp/connections', env);
    expect(res.status).toBe(404);
  });

  it('lists providers + active connections with parsed metadata for an owned site', async () => {
    const env = makeEnv(
      makeDb([
        OWNED_SITE,
        {
          match: 'FROM mcp_connections WHERE site_id = ?',
          resp: { all: [{ id: 'c1', provider: 'github', account_metadata_json: '{"login":"x"}' }] },
        },
      ]),
    );
    const res = await req(makeApp(AUTH), 'GET', '/api/sites/s1/mcp/connections', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { providers: unknown; connections: Array<{ metadata: unknown }> } };
    expect(json.data.providers).toBeTruthy();
    expect(json.data.connections[0].metadata).toEqual({ login: 'x' });
  });
});
