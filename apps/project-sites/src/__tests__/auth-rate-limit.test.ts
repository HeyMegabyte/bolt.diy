/**
 * @module __tests__/auth-rate-limit
 *
 * @description
 * Validates the auth-surface rate-limit budgets from improvement item #6.
 * Every `/api/auth/*` endpoint must:
 *   - allow requests under the per-IP budget,
 *   - return 429 with `Retry-After` once the budget is exhausted,
 *   - re-allow traffic after the sliding window expires (KV TTL drives this).
 *
 * Tests mount the real `rateLimitMiddleware` against a tiny Hono app and
 * inject a KV stub that honours `expirationTtl` against a virtual clock.
 */

import { Hono } from 'hono';
import { rateLimitMiddleware } from '../middleware/rate_limit.js';

/**
 * Build an in-memory KV stub that honours `expirationTtl` against a virtual
 * clock. The clock is driven by `now()` so tests can fast-forward without
 * relying on real `setTimeout`s.
 *
 * @example
 * ```ts
 * const clock = { now: 1_000_000 };
 * const kv = createKv(() => clock.now);
 * clock.now += 61_000; // fast-forward past a 60s window
 * ```
 */
function createKv(now: () => number): KVNamespace {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const kv = {
    get: jest.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),
    put: jest.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      const ttl = opts?.expirationTtl ?? 3600;
      store.set(key, { value, expiresAt: now() + ttl * 1000 });
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
  return kv as unknown as KVNamespace;
}

/**
 * Spin a Hono app that wires the rate-limit middleware in front of every
 * configured auth path.
 */
function createApp() {
  const app = new Hono<{ Bindings: { CACHE_KV: KVNamespace }; Variables: Record<string, never> }>();

  app.use(
    '/api/auth/magic-link',
    rateLimitMiddleware({ maxRequests: 5, windowSeconds: 60, prefix: 'auth:magic-link' }),
  );
  app.use(
    '/api/auth/magic-link/verify',
    rateLimitMiddleware({ maxRequests: 10, windowSeconds: 60, prefix: 'auth:magic-link-verify' }),
  );
  app.use(
    '/api/auth/google',
    rateLimitMiddleware({ maxRequests: 20, windowSeconds: 60, prefix: 'auth:google' }),
  );
  app.use(
    '/api/auth/google/callback',
    rateLimitMiddleware({ maxRequests: 20, windowSeconds: 60, prefix: 'auth:google-callback' }),
  );
  app.use(
    '/api/auth/github',
    rateLimitMiddleware({ maxRequests: 20, windowSeconds: 60, prefix: 'auth:github' }),
  );
  app.use(
    '/api/auth/github/callback',
    rateLimitMiddleware({ maxRequests: 20, windowSeconds: 60, prefix: 'auth:github-callback' }),
  );

  app.all('/api/auth/*', (c) => c.json({ ok: true }));
  return app;
}

const IP = '203.0.113.5';

describe('auth rate-limit (item #6)', () => {
  let clock: { now: number };
  let kv: KVNamespace;
  let app: ReturnType<typeof createApp>;

  /**
   * Shortcut: fire one request against the wired app with the shared KV +
   * stable IP, returning the Response. Mirrors how production traffic hits
   * the worker (CF-Connecting-IP header + KV binding via env).
   */
  function hit(
    path: string,
    method: 'GET' | 'POST' = 'POST',
    ip: string = IP,
  ): Promise<Response> {
    return app.request(
      path,
      { method, headers: { 'cf-connecting-ip': ip } },
      { CACHE_KV: kv },
    );
  }

  beforeEach(() => {
    clock = { now: 1_700_000_000_000 };
    jest.spyOn(Date, 'now').mockImplementation(() => clock.now);
    kv = createKv(() => clock.now);
    app = createApp();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['/api/auth/magic-link', 5, 'POST'],
    ['/api/auth/magic-link/verify', 10, 'POST'],
    ['/api/auth/google', 20, 'GET'],
    ['/api/auth/google/callback', 20, 'GET'],
    ['/api/auth/github', 20, 'GET'],
    ['/api/auth/github/callback', 20, 'GET'],
  ])('allows requests under the budget on %s (budget=%i)', async (path, budget, method) => {
    for (let i = 0; i < budget; i++) {
      const res = await hit(path, method as 'GET' | 'POST');
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 with Retry-After + standard envelope past the magic-link budget', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await hit('/api/auth/magic-link');
      expect(res.status).toBe(200);
    }

    const blocked = await hit('/api/auth/magic-link');

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');

    const body = (await blocked.json()) as { error: { code: string; retry_after: number } };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.retry_after).toBe(60);
  });

  it('returns 429 once the GitHub OAuth callback budget is exceeded', async () => {
    for (let i = 0; i < 20; i++) {
      const ok = await hit('/api/auth/github/callback?code=x&state=y', 'GET');
      expect(ok.status).toBe(200);
    }
    const blocked = await hit('/api/auth/github/callback?code=x&state=y', 'GET');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
  });

  it('sliding window forgets after 60s (TTL expiry)', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await hit('/api/auth/magic-link');
      expect(res.status).toBe(200);
    }
    const blocked = await hit('/api/auth/magic-link');
    expect(blocked.status).toBe(429);

    // Fast-forward past the 60-second sliding window. KV TTL expires the
    // counter, the next request should be allowed afresh.
    clock.now += 61_000;

    const reopened = await hit('/api/auth/magic-link');
    expect(reopened.status).toBe(200);
  });

  it('partitions counters per IP (one abuser does not starve another)', async () => {
    for (let i = 0; i < 5; i++) {
      await hit('/api/auth/magic-link', 'POST', '198.51.100.1');
    }
    const otherIp = await hit('/api/auth/magic-link', 'POST', '198.51.100.2');
    expect(otherIp.status).toBe(200);
  });
});
