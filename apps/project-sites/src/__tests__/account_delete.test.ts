/**
 * DELETE /api/admin/account — self-service account deletion.
 *
 * The admin "Danger zone → Delete account" button (user-settings.component.ts
 * `performDelete()`) calls `DELETE /api/admin/account`. Before this suite the
 * route did not exist, so the button always 404'd into an error toast — a dead
 * mutation. This locks the wired behaviour:
 *
 * 1. 401 when no userId (unauthenticated)
 * 2. 403 when userId resolves but orgId does not (no org context)
 * 3. Happy path: soft-deletes the user, archives every site in the caller's
 *    org, revokes all the user's sessions, writes an audit log, returns
 *    { data: { deleted: true, subscription_canceled } }
 * 4. Best-effort Stripe subscription cancel-at-period-end when a paid sub
 *    exists — a Stripe failure must NOT block the deletion
 *
 * Soft-delete (sets `deleted_at`) is intentional + recoverable (D1 Time Travel
 * + the `deleted_at` convention), matching the UI copy "scheduled for deletion".
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
  getAuditLogs: jest.fn().mockResolvedValue({ data: [] }),
  getSiteAuditLogs: jest.fn().mockResolvedValue({ data: [] }),
}));

jest.mock('../lib/sentry.js', () => ({
  captureError: jest.fn(),
  captureMessage: jest.fn(),
  createSentry: jest.fn(),
}));

jest.mock('../lib/posthog.js', () => ({
  capture: jest.fn(),
  trackAuth: jest.fn(),
  trackSite: jest.fn(),
  trackError: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';
import { dbExecute, dbQueryOne } from '../services/db.js';
import { writeAuditLog } from '../services/audit.js';

const mockDbExecute = dbExecute as jest.Mock;
const mockDbQueryOne = dbQueryOne as jest.Mock;
const mockWriteAuditLog = writeAuditLog as jest.Mock;

const originalFetch = global.fetch;
let mockFetch: jest.Mock;

function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    CACHE_KV: { delete: jest.fn().mockResolvedValue(undefined) } as unknown as KVNamespace,
    STRIPE_SECRET_KEY: 'sk_test_123',
    ...overrides,
  } as unknown as Env;
}

function createAuthenticatedApp(vars: Partial<Variables> = {}, envOverrides: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', api);
  return { app, env: createMockEnv(envOverrides) };
}

function del(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  env: Env,
) {
  return app.request('/api/admin/account', { method: 'DELETE' }, env);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockDbQueryOne.mockResolvedValue(null);
  mockDbExecute.mockResolvedValue({ error: null, changes: 1 });
  mockFetch = jest.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'sub_mock' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  global.fetch = mockFetch;
});

afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});

describe('DELETE /api/admin/account', () => {
  it('returns 401 when unauthenticated (no userId)', async () => {
    const { app, env } = createAuthenticatedApp({});
    const res = await del(app, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('UNAUTHORIZED');
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('returns 403 when userId resolves but orgId does not', async () => {
    const { app, env } = createAuthenticatedApp({ userId: 'user-1' });
    const res = await del(app, env);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('soft-deletes user, archives org sites, revokes sessions, audits, returns deleted:true', async () => {
    const { app, env } = createAuthenticatedApp({ userId: 'user-1', orgId: 'org-1' });
    const res = await del(app, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { deleted?: boolean; subscription_canceled?: boolean } };
    expect(body.data?.deleted).toBe(true);
    expect(body.data?.subscription_canceled).toBe(false);

    // Three soft-delete UPDATEs ran: sites, sessions, user.
    const sqls = mockDbExecute.mock.calls.map((call) => String(call[1]));
    expect(sqls.some((s) => /UPDATE sites SET.*deleted_at.*org_id = \?/i.test(s) && /archived/i.test(s))).toBe(true);
    expect(sqls.some((s) => /UPDATE sessions SET.*deleted_at.*user_id = \?/i.test(s))).toBe(true);
    expect(sqls.some((s) => /UPDATE users SET.*deleted_at.*WHERE id = \?/i.test(s))).toBe(true);

    // Audit log written for the deletion request, scoped to the user.
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    const auditArg = mockWriteAuditLog.mock.calls[0][1] as Record<string, unknown>;
    expect(auditArg.action).toBe('account.deletion_requested');
    expect(auditArg.org_id).toBe('org-1');
    expect(auditArg.actor_id).toBe('user-1');
    expect(auditArg.target_id).toBe('user-1');
  });

  it('cancels the Stripe subscription at period end when a paid sub exists', async () => {
    mockDbQueryOne.mockResolvedValue({ stripe_subscription_id: 'sub_live_42' });
    const { app, env } = createAuthenticatedApp({ userId: 'user-1', orgId: 'org-1' });
    const res = await del(app, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { subscription_canceled?: boolean } };
    expect(body.data?.subscription_canceled).toBe(true);

    const stripeCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes('/v1/subscriptions/sub_live_42'),
    );
    expect(stripeCall).toBeDefined();
    expect(String(stripeCall?.[1]?.body)).toContain('cancel_at_period_end=true');
  });

  it('still deletes the account when the Stripe cancel call throws', async () => {
    mockDbQueryOne.mockResolvedValue({ stripe_subscription_id: 'sub_live_99' });
    mockFetch.mockRejectedValueOnce(new Error('stripe network down'));
    const { app, env } = createAuthenticatedApp({ userId: 'user-1', orgId: 'org-1' });
    const res = await del(app, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { deleted?: boolean; subscription_canceled?: boolean } };
    expect(body.data?.deleted).toBe(true);
    expect(body.data?.subscription_canceled).toBe(false);
    // The user soft-delete still ran despite the Stripe failure.
    const sqls = mockDbExecute.mock.calls.map((call) => String(call[1]));
    expect(sqls.some((s) => /UPDATE users SET.*deleted_at/i.test(s))).toBe(true);
  });
});
