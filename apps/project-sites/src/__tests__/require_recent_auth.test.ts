/**
 * require_recent_auth — step-up re-auth guard (new-50 #2). Locks the age math,
 * the createdAt coercion (Date/ISO/epoch), and the 401 REAUTH_REQUIRED behavior.
 */
let session: { createdAt?: string | number | Date } | null = null;
let getSessionThrows = false;
jest.mock('../auth/better-auth.js', () => ({
  makeAuth: () => ({
    api: {
      getSession: async () => {
        if (getSessionThrows) throw new Error('no session');
        return session === null ? null : { session };
      },
    },
  }),
}));

import {
  sessionAgeSeconds,
  isRecentEnough,
  requireRecentAuth,
  DEFAULT_FRESH_WINDOW_SECONDS,
} from '../middleware/require_recent_auth.js';

const NOW = 1_700_000_000_000;

describe('sessionAgeSeconds', () => {
  const authWith = (createdAt: string | number | Date | undefined, throws = false) => ({
    api: {
      getSession: async () => {
        if (throws) throw new Error('boom');
        return createdAt === undefined ? null : { session: { createdAt } };
      },
    },
  });
  it('computes age from an epoch-ms createdAt', async () => {
    expect(await sessionAgeSeconds(authWith(NOW - 60_000) as never, new Headers(), NOW)).toBe(60);
  });
  it('computes age from an ISO-string createdAt', async () => {
    const iso = new Date(NOW - 120_000).toISOString();
    expect(await sessionAgeSeconds(authWith(iso) as never, new Headers(), NOW)).toBe(120);
  });
  it('returns null when there is no session', async () => {
    expect(await sessionAgeSeconds(authWith(undefined) as never, new Headers(), NOW)).toBeNull();
  });
  it('returns null (never throws) when getSession throws', async () => {
    expect(
      await sessionAgeSeconds(authWith(0, true) as never, new Headers(), NOW),
    ).toBeNull();
  });
  it('clamps negative ages (clock skew) to 0', async () => {
    expect(await sessionAgeSeconds(authWith(NOW + 5_000) as never, new Headers(), NOW)).toBe(0);
  });
});

describe('isRecentEnough', () => {
  it('fresh within window', () => expect(isRecentEnough(100, 900)).toBe(true));
  it('stale beyond window', () => expect(isRecentEnough(1000, 900)).toBe(false));
  it('null age is never recent', () => expect(isRecentEnough(null, 900)).toBe(false));
});

describe('requireRecentAuth middleware', () => {
  function run(createdAt: string | number | Date | null, maxAge?: number, throws = false) {
    session = createdAt === null ? null : { createdAt };
    getSessionThrows = throws;
    const calls = { next: 0, status: 0, code: '' };
    const c = {
      env: {},
      req: { raw: { headers: new Headers() } },
      json: (body: { error?: { code?: string } }, status: number) => {
        calls.status = status;
        calls.code = body.error?.code ?? '';
        return { status };
      },
    } as never;
    const next = async () => {
      calls.next += 1;
    };
    return requireRecentAuth(maxAge)(c, next).then(() => calls);
  }

  it('passes a freshly-authenticated session', async () => {
    const r = await run(Date.now() - 60_000);
    expect(r.next).toBe(1);
    expect(r.status).toBe(0);
  });

  it('401 REAUTH_REQUIRED for a stale session', async () => {
    const r = await run(Date.now() - (DEFAULT_FRESH_WINDOW_SECONDS + 60) * 1000);
    expect(r.next).toBe(0);
    expect(r.status).toBe(401);
    expect(r.code).toBe('REAUTH_REQUIRED');
  });

  it('401 when there is no session', async () => {
    const r = await run(null);
    expect(r.status).toBe(401);
    expect(r.code).toBe('REAUTH_REQUIRED');
  });

  it('honors a custom (stricter) window', async () => {
    const r = await run(Date.now() - 6 * 60 * 1000, 5 * 60); // 6m old, 5m window
    expect(r.status).toBe(401);
  });
});
