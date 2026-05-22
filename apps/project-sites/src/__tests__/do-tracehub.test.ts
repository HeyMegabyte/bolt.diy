/**
 * Unit tests for {@link TraceHub} + {@link ActivityHub} SQLite-backed
 * Durable Objects (item #61).
 *
 * Mocks `this.ctx.storage.sql` with an in-memory recorder that captures
 * every `.exec(...)` call so we can assert:
 *   - Schema DDL runs on first fetch (idempotent CREATE TABLE IF NOT EXISTS).
 *   - POST /events INSERTs into trace_events with the wire-format payload.
 *   - GET /events runs the parameterized SELECT and returns the rows.
 *   - ActivityHub mirrors the same pattern for /activity.
 */

jest.mock('cloudflare:workers', () => ({
  __esModule: true,
  WorkflowEntrypoint: class<E, P> {
    env: E;
    constructor(_ctx: unknown, env: E) { this.env = env; }
  },
  DurableObject: class<E> {
    ctx: { storage: { sql: { exec: jest.Mock } } };
    env: E;
    constructor(ctx: unknown, env: E) {
      this.ctx = ctx as { storage: { sql: { exec: jest.Mock } } };
      this.env = env;
    }
  },
}), { virtual: true });

import { TraceHub, ActivityHub } from '../durable_objects/trace_hub.js';
import type { Env } from '../types/env.js';

function makeCtx(): {
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

describe('TraceHub (SQLite-backed DO)', () => {
  it('runs schema DDL on first fetch and inserts a trace event via SQL', async () => {
    const { ctx, calls } = makeCtx();
    const hub = new TraceHub(ctx as unknown as DurableObjectState, {} as Env);
    const req = new Request('http://do/events', {
      method: 'POST',
      body: JSON.stringify({ service: 'route', level: 'info', message: 'hi' }),
    });
    const res = await hub.fetch(req);
    expect(res.status).toBe(200);

    // First exec must be the schema bootstrap.
    expect(calls[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS trace_events');
    // Second exec must be the INSERT, with positional parameters bound.
    const insert = calls.find((c) => c.sql.includes('INSERT INTO trace_events'));
    expect(insert).toBeDefined();
    expect(insert!.params[3]).toBe('route'); // service
    expect(insert!.params[4]).toBe('info'); // level
    expect(insert!.params[5]).toBe('hi'); // message
  });

  it('does not re-run schema DDL on subsequent fetches (schemaReady cache)', async () => {
    const { ctx, calls } = makeCtx();
    const hub = new TraceHub(ctx as unknown as DurableObjectState, {} as Env);
    await hub.fetch(new Request('http://do/events', {
      method: 'POST',
      body: JSON.stringify({ service: 'a', level: 'info', message: 'x' }),
    }));
    await hub.fetch(new Request('http://do/events', {
      method: 'POST',
      body: JSON.stringify({ service: 'b', level: 'info', message: 'y' }),
    }));
    const schemaCalls = calls.filter((c) => c.sql.includes('CREATE TABLE'));
    expect(schemaCalls.length).toBe(1);
  });

  it('GET /events runs a SELECT and returns the result as JSON', async () => {
    const { ctx } = makeCtx();
    // Override toArray to return a row.
    ctx.storage.sql.exec.mockReset().mockImplementation((sql: string) => ({
      toArray: () =>
        sql.startsWith('SELECT')
          ? [{ id: 'r1', ts: 1, request_id: null, service: 'route', level: 'info', message: 'hi', payload: null }]
          : [],
    }));
    const hub = new TraceHub(ctx as unknown as DurableObjectState, {} as Env);
    const res = await hub.fetch(new Request('http://do/events?limit=10'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events.length).toBe(1);
  });
});

describe('ActivityHub (SQLite-backed DO)', () => {
  it('runs schema DDL and inserts activity rows with parameterized SQL', async () => {
    const { ctx, calls } = makeCtx();
    const hub = new ActivityHub(ctx as unknown as DurableObjectState, {} as Env);
    const res = await hub.fetch(new Request('http://do/activity', {
      method: 'POST',
      body: JSON.stringify({ org_id: 'o1', action: 'site.published', target_id: 's1' }),
    }));
    expect(res.status).toBe(200);
    expect(calls[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS activity_events');
    const insert = calls.find((c) => c.sql.includes('INSERT INTO activity_events'));
    expect(insert).toBeDefined();
    expect(insert!.params[2]).toBe('o1'); // org_id
    expect(insert!.params[4]).toBe('site.published'); // action
  });

  it('GET /activity?org_id=... filters by org_id via parameterized SQL', async () => {
    const { ctx } = makeCtx();
    ctx.storage.sql.exec.mockReset().mockImplementation((sql: string, ...params: unknown[]) => ({
      toArray: () => (sql.includes('WHERE org_id = ?') && params[0] === 'o1' ? [{ id: 'a' }] : []),
    }));
    const hub = new ActivityHub(ctx as unknown as DurableObjectState, {} as Env);
    const res = await hub.fetch(new Request('http://do/activity?org_id=o1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events.length).toBe(1);
  });
});
