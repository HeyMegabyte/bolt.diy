/**
 * Additive unit tests for {@link TraceHub} + {@link ActivityHub} SQLite-backed
 * Durable Objects (convergence r51).
 *
 * Sibling `do-tracehub.test.ts` already covers the happy paths (schema DDL,
 * INSERT, basic SELECT, org-filtered SELECT). This spec covers the branches
 * that sibling LEAVES UNCOVERED — strictly no overlap:
 *   - legacy-noop path when `ctx.storage.sql` is absent (POST returns
 *     `{ mode: 'legacy-noop' }`, GET returns `{ events: [] }` without touching SQL).
 *   - 404 fallback for unknown method + unknown path.
 *   - payload / metadata JSON-serialization branch (defined → JSON.stringify,
 *     undefined → null bound parameter).
 *   - GET limit clamp to the 500 ceiling + default-100 when absent + parse of
 *     an explicit smaller limit.
 *   - GET /activity WITHOUT org_id (the unfiltered SELECT branch).
 *   - request_id / actor_id / target_id null-coalescing on POST.
 */

jest.mock('cloudflare:workers', () => ({
  __esModule: true,
  WorkflowEntrypoint: class<E, P> {
    env: E;
    constructor(_ctx: unknown, env: E) {
      this.env = env;
    }
  },
  DurableObject: class<E> {
    ctx: { storage: { sql?: { exec: jest.Mock } } };
    env: E;
    constructor(ctx: unknown, env: E) {
      this.ctx = ctx as { storage: { sql?: { exec: jest.Mock } } };
      this.env = env;
    }
  },
}), { virtual: true });

import { TraceHub, ActivityHub } from '../durable_objects/trace_hub.js';
import type { Env } from '../types/env.js';

/** Build a ctx whose `storage.sql` is a recording jest mock. */
function makeSqlCtx(): {
  ctx: { storage: { sql: { exec: jest.Mock } } };
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const exec = jest.fn().mockImplementation((sql: string, ...params: unknown[]) => {
    calls.push({ sql, params });
    return { toArray: () => [] };
  });
  return { ctx: { storage: { sql: { exec } } }, calls };
}

/** Build a ctx with NO `sql` handle — exercises the legacy-noop branch. */
function makeLegacyCtx(): { ctx: { storage: Record<string, never> } } {
  return { ctx: { storage: {} } };
}

describe('TraceHub — uncovered branches (convergence r51)', () => {
  it('POST /events without SQL backend returns legacy-noop and never inserts', async () => {
    const { ctx } = makeLegacyCtx();
    const hub = new TraceHub(ctx as unknown as DurableObjectState, {} as Env);
    const res = await hub.fetch(
      new Request('http://do/events', {
        method: 'POST',
        body: JSON.stringify({ service: 'route', level: 'info', message: 'hi' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; mode?: string };
    expect(body).toEqual({ ok: true, mode: 'legacy-noop' });
  });

  it('GET /events without SQL backend returns an empty events list', async () => {
    const { ctx } = makeLegacyCtx();
    const hub = new TraceHub(ctx as unknown as DurableObjectState, {} as Env);
    const res = await hub.fetch(new Request('http://do/events'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toEqual([]);
  });

  it('serializes a defined payload to JSON and binds request_id', async () => {
    const { ctx, calls } = makeSqlCtx();
    const hub = new TraceHub(ctx as unknown as DurableObjectState, {} as Env);
    await hub.fetch(
      new Request('http://do/events', {
        method: 'POST',
        body: JSON.stringify({
          request_id: 'req-1',
          service: 'svc',
          level: 'warn',
          message: 'm',
          payload: { a: 1, b: 'two' },
        }),
      }),
    );
    const insert = calls.find((c) => c.sql.includes('INSERT INTO trace_events'))!;
    expect(insert.params[2]).toBe('req-1'); // request_id bound, not null
    expect(insert.params[6]).toBe(JSON.stringify({ a: 1, b: 'two' })); // payload serialized
  });

  it('binds null for omitted request_id and undefined payload', async () => {
    const { ctx, calls } = makeSqlCtx();
    const hub = new TraceHub(ctx as unknown as DurableObjectState, {} as Env);
    await hub.fetch(
      new Request('http://do/events', {
        method: 'POST',
        body: JSON.stringify({ service: 'svc', level: 'debug', message: 'm' }),
      }),
    );
    const insert = calls.find((c) => c.sql.includes('INSERT INTO trace_events'))!;
    expect(insert.params[2]).toBeNull(); // request_id ?? null
    expect(insert.params[6]).toBeNull(); // payload undefined → null
  });

  it('clamps GET limit to the 500 ceiling', async () => {
    const { ctx, calls } = makeSqlCtx();
    const hub = new TraceHub(ctx as unknown as DurableObjectState, {} as Env);
    await hub.fetch(new Request('http://do/events?limit=99999'));
    const select = calls.find((c) => c.sql.includes('SELECT id, ts, request_id'))!;
    expect(select.params[0]).toBe(500);
  });

  it('defaults GET limit to 100 when the param is absent', async () => {
    const { ctx, calls } = makeSqlCtx();
    const hub = new TraceHub(ctx as unknown as DurableObjectState, {} as Env);
    await hub.fetch(new Request('http://do/events'));
    const select = calls.find((c) => c.sql.includes('SELECT id, ts, request_id'))!;
    expect(select.params[0]).toBe(100);
  });

  it('honors an explicit GET limit under the ceiling', async () => {
    const { ctx, calls } = makeSqlCtx();
    const hub = new TraceHub(ctx as unknown as DurableObjectState, {} as Env);
    await hub.fetch(new Request('http://do/events?limit=25'));
    const select = calls.find((c) => c.sql.includes('SELECT id, ts, request_id'))!;
    expect(select.params[0]).toBe(25);
  });

  it('returns 404 for an unknown method on /events', async () => {
    const { ctx } = makeSqlCtx();
    const hub = new TraceHub(ctx as unknown as DurableObjectState, {} as Env);
    const res = await hub.fetch(new Request('http://do/events', { method: 'DELETE' }));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('not found');
  });

  it('returns 404 for an unknown path', async () => {
    const { ctx } = makeSqlCtx();
    const hub = new TraceHub(ctx as unknown as DurableObjectState, {} as Env);
    const res = await hub.fetch(new Request('http://do/unknown'));
    expect(res.status).toBe(404);
  });
});

describe('ActivityHub — uncovered branches (convergence r51)', () => {
  it('POST /activity without SQL backend returns legacy-noop', async () => {
    const { ctx } = makeLegacyCtx();
    const hub = new ActivityHub(ctx as unknown as DurableObjectState, {} as Env);
    const res = await hub.fetch(
      new Request('http://do/activity', {
        method: 'POST',
        body: JSON.stringify({ action: 'x' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; mode?: string };
    expect(body).toEqual({ ok: true, mode: 'legacy-noop' });
  });

  it('GET /activity without SQL backend returns an empty events list', async () => {
    const { ctx } = makeLegacyCtx();
    const hub = new ActivityHub(ctx as unknown as DurableObjectState, {} as Env);
    const res = await hub.fetch(new Request('http://do/activity'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toEqual([]);
  });

  it('binds null for omitted org_id/actor_id/target_id and serializes metadata', async () => {
    const { ctx, calls } = makeSqlCtx();
    const hub = new ActivityHub(ctx as unknown as DurableObjectState, {} as Env);
    await hub.fetch(
      new Request('http://do/activity', {
        method: 'POST',
        body: JSON.stringify({ action: 'site.created', metadata: { k: 'v' } }),
      }),
    );
    const insert = calls.find((c) => c.sql.includes('INSERT INTO activity_events'))!;
    expect(insert.params[2]).toBeNull(); // org_id ?? null
    expect(insert.params[3]).toBeNull(); // actor_id ?? null
    expect(insert.params[5]).toBeNull(); // target_id ?? null
    expect(insert.params[6]).toBe(JSON.stringify({ k: 'v' })); // metadata serialized
  });

  it('binds null metadata when undefined', async () => {
    const { ctx, calls } = makeSqlCtx();
    const hub = new ActivityHub(ctx as unknown as DurableObjectState, {} as Env);
    await hub.fetch(
      new Request('http://do/activity', {
        method: 'POST',
        body: JSON.stringify({ action: 'a' }),
      }),
    );
    const insert = calls.find((c) => c.sql.includes('INSERT INTO activity_events'))!;
    expect(insert.params[6]).toBeNull();
  });

  it('GET /activity WITHOUT org_id runs the unfiltered SELECT (no WHERE clause)', async () => {
    const { ctx, calls } = makeSqlCtx();
    const hub = new ActivityHub(ctx as unknown as DurableObjectState, {} as Env);
    await hub.fetch(new Request('http://do/activity?limit=42'));
    const select = calls.find((c) => c.sql.includes('SELECT id, ts, org_id'))!;
    expect(select.sql).not.toContain('WHERE org_id = ?');
    expect(select.params[0]).toBe(42); // limit is the only bound param
  });

  it('clamps the GET /activity limit to the 500 ceiling', async () => {
    const { ctx, calls } = makeSqlCtx();
    const hub = new ActivityHub(ctx as unknown as DurableObjectState, {} as Env);
    await hub.fetch(new Request('http://do/activity?limit=10000'));
    const select = calls.find((c) => c.sql.includes('SELECT id, ts, org_id'))!;
    expect(select.params[select.params.length - 1]).toBe(500);
  });

  it('returns 404 for an unknown method on /activity', async () => {
    const { ctx } = makeSqlCtx();
    const hub = new ActivityHub(ctx as unknown as DurableObjectState, {} as Env);
    const res = await hub.fetch(new Request('http://do/activity', { method: 'PUT' }));
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown path', async () => {
    const { ctx } = makeSqlCtx();
    const hub = new ActivityHub(ctx as unknown as DurableObjectState, {} as Env);
    const res = await hub.fetch(new Request('http://do/nope'));
    expect(res.status).toBe(404);
  });
});
