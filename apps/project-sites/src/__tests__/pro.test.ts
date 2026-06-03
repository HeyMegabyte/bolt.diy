import { getProStatus, requirePro, grantPro, revokePro, type ProStatus } from '../services/pro.js';
import type { Context, Next } from 'hono';
import type { Env, Variables } from '../types/env.js';

type UserRow = {
  is_pro: number;
  pro_grant_reason: string | null;
  pro_granted_at: string | null;
  pro_expires_at: string | null;
};

const UPGRADE_URL = '/admin/billing?plan=pro';

/**
 * Mock D1 binding. `dbQueryOne` (used by getProStatus) resolves
 * `db.prepare(sql).bind(...params).all()` → `{ results: [...] }`.
 * `grantPro`/`revokePro` call `.bind(...).run()` directly; `binds` captures args.
 */
function mockDb(row: UserRow | null, binds: unknown[][] = []): D1Database {
  return {
    prepare: (_sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async () => ({ results: row ? [row] : [] }),
        run: async () => {
          binds.push(args);
          return { meta: { changes: 1 } };
        },
      }),
    }),
  } as unknown as D1Database;
}

/** Minimal Hono Context stub exposing `get('userId')`, `env`, and `json`. */
function mockCtx(
  userId: string | undefined,
  db: D1Database,
): {
  ctx: Context<{ Bindings: Env; Variables: Variables }>;
  jsonCalls: Array<{ body: unknown; status: number }>;
} {
  const jsonCalls: Array<{ body: unknown; status: number }> = [];
  const ctx = {
    get: (key: string) => (key === 'userId' ? userId : undefined),
    env: { DB: db } as unknown as Env,
    json: (body: unknown, status: number) => {
      jsonCalls.push({ body, status });
      return { body, status } as unknown as Response;
    },
  } as unknown as Context<{ Bindings: Env; Variables: Variables }>;
  return { ctx, jsonCalls };
}

const FUTURE = '2999-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

describe('getProStatus', () => {
  it('returns anonymous default (is_pro false, null user) when no userId', async () => {
    const { ctx } = mockCtx(undefined, mockDb(null));
    const status = await getProStatus(ctx);
    expect(status).toEqual<ProStatus>({
      is_pro: false,
      reason: null,
      granted_at: null,
      expires_at: null,
      user_id: null,
      upgrade_url: UPGRADE_URL,
    });
  });

  it('returns not-pro with the userId when the user row is missing', async () => {
    const { ctx } = mockCtx('u-missing', mockDb(null));
    const status = await getProStatus(ctx);
    expect(status.is_pro).toBe(false);
    expect(status.user_id).toBe('u-missing');
    expect(status.reason).toBeNull();
    expect(status.upgrade_url).toBe(UPGRADE_URL);
  });

  it('resolves an active subscription grant as pro', async () => {
    const { ctx } = mockCtx(
      'u-sub',
      mockDb({
        is_pro: 1,
        pro_grant_reason: 'subscription',
        pro_granted_at: '2026-01-01T00:00:00.000Z',
        pro_expires_at: null,
      }),
    );
    const status = await getProStatus(ctx);
    expect(status.is_pro).toBe(true);
    expect(status.reason).toBe('subscription');
    expect(status.user_id).toBe('u-sub');
    expect(status.granted_at).toBe('2026-01-01T00:00:00.000Z');
    expect(status.expires_at).toBeNull();
  });

  it('resolves a lifetime grant (e.g. Brian / founder bypass) as pro with no expiry', async () => {
    const { ctx } = mockCtx(
      'u-brian',
      mockDb({
        is_pro: 1,
        pro_grant_reason: 'lifetime',
        pro_granted_at: '2025-01-01T00:00:00.000Z',
        pro_expires_at: null,
      }),
    );
    const status = await getProStatus(ctx);
    expect(status.is_pro).toBe(true);
    expect(status.reason).toBe('lifetime');
    expect(status.expires_at).toBeNull();
  });

  it('resolves a comp grant as pro', async () => {
    const { ctx } = mockCtx(
      'u-comp',
      mockDb({
        is_pro: 1,
        pro_grant_reason: 'comp',
        pro_granted_at: '2026-02-01T00:00:00.000Z',
        pro_expires_at: null,
      }),
    );
    const status = await getProStatus(ctx);
    expect(status.is_pro).toBe(true);
    expect(status.reason).toBe('comp');
  });

  it('honors a beta grant whose expiry is in the future', async () => {
    const { ctx } = mockCtx(
      'u-beta',
      mockDb({
        is_pro: 1,
        pro_grant_reason: 'beta',
        pro_granted_at: '2026-03-01T00:00:00.000Z',
        pro_expires_at: FUTURE,
      }),
    );
    const status = await getProStatus(ctx);
    expect(status.is_pro).toBe(true);
    expect(status.reason).toBe('beta');
    expect(status.expires_at).toBe(FUTURE);
  });

  it('treats an expired beta grant as not-pro (but keeps reason + expiry surfaced)', async () => {
    const { ctx } = mockCtx(
      'u-beta-old',
      mockDb({
        is_pro: 1,
        pro_grant_reason: 'beta',
        pro_granted_at: '2025-01-01T00:00:00.000Z',
        pro_expires_at: PAST,
      }),
    );
    const status = await getProStatus(ctx);
    expect(status.is_pro).toBe(false);
    expect(status.reason).toBe('beta');
    expect(status.expires_at).toBe(PAST);
  });

  it('treats is_pro=0 as not-pro even with a grant reason present', async () => {
    const { ctx } = mockCtx(
      'u-revoked',
      mockDb({
        is_pro: 0,
        pro_grant_reason: 'revoked:cancelled',
        pro_granted_at: '2026-01-01T00:00:00.000Z',
        pro_expires_at: null,
      }),
    );
    const status = await getProStatus(ctx);
    expect(status.is_pro).toBe(false);
  });

  it('coerces a null grant reason to null', async () => {
    const { ctx } = mockCtx(
      'u-noreason',
      mockDb({
        is_pro: 1,
        pro_grant_reason: null,
        pro_granted_at: null,
        pro_expires_at: null,
      }),
    );
    const status = await getProStatus(ctx);
    expect(status.is_pro).toBe(true);
    expect(status.reason).toBeNull();
    expect(status.granted_at).toBeNull();
  });
});

describe('requirePro middleware', () => {
  it('calls next() and does not respond when the user is pro', async () => {
    const { ctx, jsonCalls } = mockCtx(
      'u-pro',
      mockDb({
        is_pro: 1,
        pro_grant_reason: 'subscription',
        pro_granted_at: '2026-01-01T00:00:00.000Z',
        pro_expires_at: null,
      }),
    );
    let nexted = false;
    const next: Next = async () => {
      nexted = true;
    };
    await requirePro(ctx, next);
    expect(nexted).toBe(true);
    expect(jsonCalls).toHaveLength(0);
  });

  it('returns 402 PRO_REQUIRED with the upgrade URL and does NOT call next when anonymous', async () => {
    const { ctx, jsonCalls } = mockCtx(undefined, mockDb(null));
    let nexted = false;
    const next: Next = async () => {
      nexted = true;
    };
    await requirePro(ctx, next);
    expect(nexted).toBe(false);
    expect(jsonCalls).toHaveLength(1);
    expect(jsonCalls[0].status).toBe(402);
    const body = jsonCalls[0].body as { error: { code: string; upgrade_url: string; message: string } };
    expect(body.error.code).toBe('PRO_REQUIRED');
    expect(body.error.upgrade_url).toBe(UPGRADE_URL);
    expect(body.error.message).toContain('Pro');
  });

  it('returns 402 when the user grant has expired', async () => {
    const { ctx, jsonCalls } = mockCtx(
      'u-expired',
      mockDb({
        is_pro: 1,
        pro_grant_reason: 'beta',
        pro_granted_at: '2025-01-01T00:00:00.000Z',
        pro_expires_at: PAST,
      }),
    );
    const next: Next = async () => {};
    await requirePro(ctx, next);
    expect(jsonCalls).toHaveLength(1);
    expect(jsonCalls[0].status).toBe(402);
  });
});

describe('grantPro', () => {
  it('binds reason, actor, expiry, and userId in order with default null expiry', async () => {
    const binds: unknown[][] = [];
    const db = mockDb(null, binds);
    await grantPro(db, 'u-1', 'comp', 'admin-7');
    expect(binds).toHaveLength(1);
    expect(binds[0]).toEqual(['comp', 'admin-7', null, 'u-1']);
  });

  it('passes an explicit expiry through for beta grants', async () => {
    const binds: unknown[][] = [];
    const db = mockDb(null, binds);
    await grantPro(db, 'u-2', 'beta', 'subscription', FUTURE);
    expect(binds[0]).toEqual(['beta', 'subscription', FUTURE, 'u-2']);
  });
});

describe('revokePro', () => {
  it('binds actor, prefixed reason, and userId in order', async () => {
    const binds: unknown[][] = [];
    const db = mockDb(null, binds);
    await revokePro(db, 'u-3', 'system', 'subscription_cancelled');
    expect(binds).toHaveLength(1);
    expect(binds[0]).toEqual(['system', 'revoked:subscription_cancelled', 'u-3']);
  });
});
