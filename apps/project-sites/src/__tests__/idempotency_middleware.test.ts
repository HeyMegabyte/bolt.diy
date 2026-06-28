import { Hono } from 'hono';
import { idempotencyMiddleware, idempotencyCacheKey } from '../middleware/idempotency.js';

/** Minimal in-memory KV stub (get 'json' + put with options). */
function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (k: string, _t?: string) => {
      const v = store.get(k);
      return v === undefined ? null : JSON.parse(v);
    }),
    put: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
  };
}

function makeApp(kv: ReturnType<typeof makeKv>, orgId: string | null, handler: () => unknown) {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.env = { CACHE_KV: kv } as any;
    if (orgId) c.set('orgId', orgId);
    await next();
  });
  app.use('*', idempotencyMiddleware as any);
  app.post('/api/thing', (c) => c.json(handler() as any, 201));
  return app;
}

describe('idempotencyCacheKey', () => {
  it('scopes by org + method + path + client key', () => {
    expect(idempotencyCacheKey('org_1', 'POST', '/api/thing', 'k1')).toBe(
      'idem:org_1:POST:/api/thing:k1',
    );
    // different org → different key (no cross-tenant replay)
    expect(idempotencyCacheKey('org_2', 'POST', '/api/thing', 'k1')).not.toBe(
      idempotencyCacheKey('org_1', 'POST', '/api/thing', 'k1'),
    );
  });
});

describe('idempotencyMiddleware', () => {
  it('runs the handler once and REPLAYS the cached response on a duplicate key', async () => {
    const kv = makeKv();
    let calls = 0;
    const app = makeApp(kv, 'org_1', () => ({ n: ++calls }));

    const req = () =>
      app.request('/api/thing', {
        method: 'POST',
        headers: { 'idempotency-key': 'k-abc' },
      });

    const r1 = await req();
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ n: 1 });
    expect(r1.headers.get('idempotency-replayed')).toBeNull();

    const r2 = await req();
    expect(r2.status).toBe(201);
    expect(await r2.json()).toEqual({ n: 1 }); // SAME body — handler did not re-run
    expect(r2.headers.get('idempotency-replayed')).toBe('true');
    expect(calls).toBe(1); // handler executed exactly once
  });

  it('is a no-op without the header (handler runs every time)', async () => {
    const kv = makeKv();
    let calls = 0;
    const app = makeApp(kv, 'org_1', () => ({ n: ++calls }));
    await app.request('/api/thing', { method: 'POST' });
    await app.request('/api/thing', { method: 'POST' });
    expect(calls).toBe(2);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('does NOT cache a non-2xx response (errors stay retryable)', async () => {
    const kv = makeKv();
    const app = new Hono<any>();
    app.use('*', async (c, next) => {
      c.env = { CACHE_KV: kv } as any;
      c.set('orgId', 'org_1');
      await next();
    });
    app.use('*', idempotencyMiddleware as any);
    app.post('/api/thing', (c) => c.json({ error: 'boom' }, 500));

    await app.request('/api/thing', {
      method: 'POST',
      headers: { 'idempotency-key': 'k-err' },
    });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('does not replay across tenants (org_2 cannot read org_1’s cached response)', async () => {
    const kv = makeKv();
    let calls = 0;
    const a = makeApp(kv, 'org_1', () => ({ n: ++calls, who: 'org_1' }));
    const b = makeApp(kv, 'org_2', () => ({ n: ++calls, who: 'org_2' }));
    await a.request('/api/thing', { method: 'POST', headers: { 'idempotency-key': 'shared' } });
    const r = await b.request('/api/thing', { method: 'POST', headers: { 'idempotency-key': 'shared' } });
    // org_2 gets its OWN fresh response, not org_1's replay
    expect((await r.json()).who).toBe('org_2');
    expect(calls).toBe(2);
  });
});
