/**
 * Unit coverage for the `AppRuntimeContainer` Durable Object
 * (`src/durable_objects/app_runtime.ts`) — the container build/runtime
 * orchestrator implementing god-tier pattern #8 (restart-cap 3/min,
 * idle-hibernate 30m, 1000-line ring-buffer logs).
 *
 * Strategy: NOT Miniflare. We mock `@cloudflare/containers` (an ESM package
 * jest can't transform) so the parent `Container` class is a controllable
 * stub, then drive the DO with a hand-rolled `DurableObjectState` whose
 * SQLite `sql.exec` and `waitUntil` are jest mocks. This exercises the
 * EXTRACTABLE LOGIC directly: ring-buffer INSERT+trim SQL, restart-count
 * rolling-window cap, lifecycle/state transitions, status snapshot, the
 * HTTP shim router, onError/onStart/onStop hooks, and lazy-boot in
 * proxyRequest. The CFC container plumbing itself (startAndWaitForPorts,
 * containerFetch) is stubbed — that part is genuinely Miniflare-only.
 */

// Mock the ESM container package BEFORE importing the subclass. The base
// `Container` stub assigns `ctx`/`env` and provides jest-mock stand-ins for
// every parent method the subclass calls.
jest.mock('@cloudflare/containers', () => {
  // `stop` is defined on the PROTOTYPE (not an instance field) because the
  // subclass calls `super.stop('SIGTERM')` — `super.*` resolves up the
  // prototype chain and would not see an own-instance jest.fn. The other
  // helpers are called via `this.*`, so own-instance fields are fine and
  // keep them trivially spy-able per test.
  class Container {
    public ctx: unknown;
    public env: unknown;
    public defaultPort = 0;
    public sleepAfter = '';
    public enableInternet = false;
    public startAndWaitForPorts = jest.fn().mockResolvedValue(undefined);
    public containerFetch = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    public renewActivityTimeout = jest.fn();
    public stop = jest.fn().mockResolvedValue(undefined);
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  }
  // Mirror `stop` onto the prototype so `super.stop(...)` dispatches to the
  // same jest.fn the instance field exposes for assertions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Container.prototype as any).stop = function stop(this: any, ...args: unknown[]) {
    return this.stop.apply(this, args);
  };
  return { Container };
});

import { AppRuntimeContainer } from '../durable_objects/app_runtime.js';
import type { AppRuntimeStartOpts } from '../durable_objects/app_runtime.js';

// ── In-memory SQLite double ───────────────────────────────────────────────
//
// A tiny stand-in for `ctx.storage.sql` that records every exec() call and
// maintains just enough state (app_meta KV + app_logs ring) so the DO's own
// SQL produces observable behaviour. We parse the handful of literal SQL
// statements the DO emits — not a real engine, just faithful to these queries.

interface FakeLogRow {
  id: number;
  ts: number;
  stream: string;
  line: string;
}

class FakeSql {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  meta = new Map<string, string>();
  logs: FakeLogRow[] = [];
  private nextId = 1;

  exec<T = Record<string, unknown>>(sql: string, ...params: unknown[]): { toArray(): T[] } {
    this.calls.push({ sql, params });
    const norm = sql.replace(/\s+/g, ' ').trim();

    // SELECT value FROM app_meta WHERE key = ?
    if (/SELECT value FROM app_meta WHERE key = \?/i.test(norm)) {
      const key = params[0] as string;
      const v = this.meta.get(key);
      const rows = v === undefined ? [] : [{ value: v }];
      return { toArray: () => rows as unknown as T[] };
    }

    // INSERT INTO app_meta ... ON CONFLICT ... (upsert)
    if (/INSERT INTO app_meta/i.test(norm)) {
      this.meta.set(params[0] as string, params[1] as string);
      return { toArray: () => [] };
    }

    // INSERT INTO app_logs (ts, stream, line)
    if (/INSERT INTO app_logs/i.test(norm)) {
      this.logs.push({
        id: this.nextId++,
        ts: params[0] as number,
        stream: params[1] as string,
        line: params[2] as string,
      });
      return { toArray: () => [] };
    }

    // DELETE FROM app_logs WHERE id NOT IN (... ORDER BY ts DESC LIMIT ?) (ring trim)
    if (/DELETE FROM app_logs WHERE id NOT IN/i.test(norm)) {
      const limit = params[params.length - 1] as number;
      const keep = [...this.logs].sort((a, b) => b.ts - a.ts).slice(0, limit);
      const keepIds = new Set(keep.map((r) => r.id));
      this.logs = this.logs.filter((r) => keepIds.has(r.id));
      return { toArray: () => [] };
    }

    // SELECT ts, stream, line FROM app_logs ORDER BY ts DESC LIMIT ?
    if (/SELECT ts, stream, line FROM app_logs/i.test(norm)) {
      const limit = params[0] as number;
      const rows = [...this.logs]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit)
        .map((r) => ({ ts: r.ts, stream: r.stream, line: r.line }));
      return { toArray: () => rows as unknown as T[] };
    }

    // CREATE TABLE / CREATE INDEX schema — no-op.
    return { toArray: () => [] };
  }
}

function makeCtx(sql: FakeSql | null) {
  const waitUntil = jest.fn((p: Promise<unknown>) => {
    // Swallow rejection so unhandled-promise noise doesn't leak between tests.
    void Promise.resolve(p).catch(() => undefined);
  });
  return {
    waitUntil,
    storage: sql ? { sql } : {},
  };
}

function makeDO(sql: FakeSql | null = new FakeSql()) {
  const ctx = makeCtx(sql);
  const env = { ENVIRONMENT: 'test' };
  const inst = new AppRuntimeContainer(ctx as never, env as never);
  return { inst, ctx, sql };
}

const baseOpts: AppRuntimeStartOpts = {
  image: 'umami:postgresql-latest',
  port: 3000,
  env: { DATABASE_URL: 'postgres://x', SECRET: 'shh' },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AppRuntimeContainer — config + defaults (god-tier pattern #8)', () => {
  it('sets the 30-minute idle-hibernation window', () => {
    const { inst } = makeDO();
    expect(inst.sleepAfter).toBe('30m');
  });

  it('enables outbound internet (apps need DBs/OAuth/webhooks)', () => {
    const { inst } = makeDO();
    expect(inst.enableInternet).toBe(true);
  });

  it('defaults the container port to 3000', () => {
    const { inst } = makeDO();
    expect(inst.defaultPort).toBe(3000);
  });

  it('assigns ctx + env from the constructor', () => {
    const { inst, ctx } = makeDO();
    expect((inst as unknown as { ctx: unknown }).ctx).toBe(ctx);
  });
});

describe('AppRuntimeContainer — startApp lifecycle', () => {
  it('persists catalog config (image/port/env) and reaches running state', async () => {
    const { inst, sql } = makeDO();
    const res = await inst.startApp(baseOpts);
    expect(res.state).toBe('running');
    expect(sql!.meta.get('image')).toBe('umami:postgresql-latest');
    expect(sql!.meta.get('port')).toBe('3000');
    expect(JSON.parse(sql!.meta.get('env')!)).toEqual(baseOpts.env);
    expect(sql!.meta.get('state')).toBe('running');
    expect(sql!.meta.get('booted_at')).toBeTruthy();
  });

  it('calls the parent startAndWaitForPorts with the declared port + env', async () => {
    const { inst } = makeDO();
    const spy = (inst as unknown as { startAndWaitForPorts: jest.Mock }).startAndWaitForPorts;
    await inst.startApp(baseOpts);
    expect(spy).toHaveBeenCalledTimes(1);
    const [ports, , overrides] = spy.mock.calls[0];
    expect(ports).toEqual([3000]);
    expect(overrides.envVars).toEqual(baseOpts.env);
    expect(overrides.enableInternet).toBe(true);
  });

  it('is idempotent — a second start while running is a no-op return', async () => {
    const { inst } = makeDO();
    const spy = (inst as unknown as { startAndWaitForPorts: jest.Mock }).startAndWaitForPorts;
    await inst.startApp(baseOpts);
    const res2 = await inst.startApp(baseOpts);
    expect(res2.state).toBe('running');
    expect(spy).toHaveBeenCalledTimes(1); // not booted twice
  });

  it('persists an optional entrypoint override', async () => {
    const { inst, sql } = makeDO();
    await inst.startApp({ ...baseOpts, entrypoint: ['/bin/sh', '-c', 'app'] });
    expect(JSON.parse(sql!.meta.get('entrypoint')!)).toEqual(['/bin/sh', '-c', 'app']);
  });

  it('flips to crashed + records last_error when boot throws', async () => {
    const { inst, sql } = makeDO();
    (inst as unknown as { startAndWaitForPorts: jest.Mock }).startAndWaitForPorts.mockRejectedValueOnce(
      new Error('port timeout'),
    );
    await expect(inst.startApp(baseOpts)).rejects.toThrow('port timeout');
    expect(sql!.meta.get('state')).toBe('crashed');
    expect(sql!.meta.get('last_error')).toBe('port timeout');
    const status = await inst.getStatus();
    expect(status.state).toBe('crashed');
  });
});

describe('AppRuntimeContainer — stopApp / restartApp', () => {
  it('stopApp SIGTERMs the container and flips to stopped', async () => {
    const { inst, sql } = makeDO();
    await inst.startApp(baseOpts);
    const stopSpy = (inst as unknown as { stop: jest.Mock }).stop;
    const res = await inst.stopApp();
    expect(res.state).toBe('stopped');
    expect(stopSpy).toHaveBeenCalledWith('SIGTERM');
    expect(sql!.meta.get('state')).toBe('stopped');
  });

  it('stopApp is idempotent when the parent stop() throws', async () => {
    const { inst } = makeDO();
    (inst as unknown as { stop: jest.Mock }).stop.mockRejectedValueOnce(new Error('already gone'));
    const res = await inst.stopApp();
    expect(res.state).toBe('stopped');
  });

  it('restartApp throws when no prior start config exists', async () => {
    const { inst } = makeDO();
    await expect(inst.restartApp()).rejects.toThrow(/never been started/);
  });

  it('restartApp reuses persisted opts and reaches running', async () => {
    const { inst } = makeDO();
    await inst.startApp(baseOpts);
    await inst.stopApp();
    const res = await inst.restartApp();
    expect(res.state).toBe('running');
  });
});

describe('AppRuntimeContainer — ring-buffer logging (1000-line cap)', () => {
  it('emits INSERT then the trim DELETE keeping the last 1000 rows', async () => {
    const { inst, sql } = makeDO();
    await inst.startApp(baseOpts); // writes a couple system log lines
    const inserts = sql!.calls.filter((c) => /INSERT INTO app_logs/i.test(c.sql));
    const trims = sql!.calls.filter((c) => /DELETE FROM app_logs WHERE id NOT IN/i.test(c.sql));
    expect(inserts.length).toBeGreaterThan(0);
    expect(trims.length).toBe(inserts.length); // every write trims
    // The trim's LIMIT param is the 1000-line ring cap.
    expect(trims[0].params[trims[0].params.length - 1]).toBe(1000);
  });

  it('trims the in-memory ring to 1000 rows after >1000 writes', () => {
    const { inst, sql } = makeDO();
    // Each onError → writeLog → INSERT + ring-trim DELETE. >1000 calls must
    // leave the ring at the 1000-row cap.
    jest.spyOn(inst, 'restartApp').mockResolvedValue({ state: 'running' });
    for (let i = 0; i < 1050; i++) inst.onError(new Error(`e${i}`));
    expect(sql!.logs.length).toBeLessThanOrEqual(1000);
    expect(sql!.logs.length).toBe(1000);
  });

  it('getLogs returns oldest-first (chronological) up to the tail', async () => {
    const { inst, sql } = makeDO();
    sql!.logs.push(
      { id: 1, ts: 100, stream: 'system', line: 'first' },
      { id: 2, ts: 200, stream: 'stdout', line: 'second' },
      { id: 3, ts: 300, stream: 'stderr', line: 'third' },
    );
    const lines = await inst.getLogs(10);
    expect(lines.map((l) => l.line)).toEqual(['first', 'second', 'third']);
    expect(lines[2].stream).toBe('stderr');
  });

  it('getLogs clamps tail to the [1, 1000] range', async () => {
    const { inst, sql } = makeDO();
    sql!.logs.push({ id: 1, ts: 1, stream: 'system', line: 'x' });
    await inst.getLogs(99999);
    const lastSelect = [...sql!.calls]
      .reverse()
      .find((c) => /SELECT ts, stream, line FROM app_logs/i.test(c.sql));
    expect(lastSelect!.params[0]).toBe(1000);
  });

  it('getLogs returns [] when SQLite is unavailable', async () => {
    const { inst } = makeDO(null);
    await expect(inst.getLogs(10)).resolves.toEqual([]);
  });
});

describe('AppRuntimeContainer — restart-count rolling-window cap (≤3/min)', () => {
  it('schedules auto-restarts up to the 3/min cap then suppresses', () => {
    const { inst, sql, ctx } = makeDO();
    const restartSpy = jest
      .spyOn(inst, 'restartApp')
      .mockResolvedValue({ state: 'running' });

    // 3 errors within the rolling window → 3 scheduled restarts.
    inst.onError(new Error('crash 1'));
    inst.onError(new Error('crash 2'));
    inst.onError(new Error('crash 3'));
    expect(ctx.waitUntil).toHaveBeenCalledTimes(3);

    // 4th within the same window → suppressed (cap hit), no new schedule.
    inst.onError(new Error('crash 4'));
    expect(ctx.waitUntil).toHaveBeenCalledTimes(3);

    const suppressed = sql!.logs.some((l) => /cap hit/.test(l.line));
    expect(suppressed).toBe(true);
    restartSpy.mockRestore();
  });

  it('restart_count in status reflects the rolling-window timestamps', async () => {
    const { inst } = makeDO();
    jest.spyOn(inst, 'restartApp').mockResolvedValue({ state: 'running' });
    inst.onError(new Error('a'));
    inst.onError(new Error('b'));
    const status = await inst.getStatus();
    expect(status.restart_count).toBe(2);
  });

  it('drops stale timestamps outside the 60s window before re-capping', () => {
    const { inst, ctx } = makeDO();
    jest.spyOn(inst, 'restartApp').mockResolvedValue({ state: 'running' });
    const NOW = 1_000_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now');

    // 3 crashes at t0 → cap reached.
    nowSpy.mockReturnValue(NOW);
    inst.onError(new Error('1'));
    inst.onError(new Error('2'));
    inst.onError(new Error('3'));
    expect(ctx.waitUntil).toHaveBeenCalledTimes(3);

    // 4th still inside window → suppressed.
    inst.onError(new Error('4'));
    expect(ctx.waitUntil).toHaveBeenCalledTimes(3);

    // Advance 61s → all stale timestamps drop, a fresh restart schedules.
    nowSpy.mockReturnValue(NOW + 61_000);
    inst.onError(new Error('5'));
    expect(ctx.waitUntil).toHaveBeenCalledTimes(4);
    nowSpy.mockRestore();
  });
});

describe('AppRuntimeContainer — getStatus snapshot', () => {
  it('reports idle + zero uptime before any boot', async () => {
    const { inst } = makeDO();
    const status = await inst.getStatus();
    expect(status.state).toBe('idle');
    expect(status.uptime_seconds).toBe(0);
    expect(status.memory_mb_used).toBe(0); // CFC metrics not exposed yet
    expect(status.restart_count).toBe(0);
  });

  it('reports positive uptime + image after a successful boot', async () => {
    const { inst } = makeDO();
    await inst.startApp(baseOpts);
    const status = await inst.getStatus();
    expect(status.state).toBe('running');
    expect(status.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(status.image).toBe('umami:postgresql-latest');
  });
});

describe('AppRuntimeContainer — proxyRequest lazy boot', () => {
  it('503s when the app was never provisioned', async () => {
    const { inst } = makeDO();
    const res = await inst.proxyRequest(new Request('https://x/'));
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/not provisioned/i);
  });

  it('lazy-boots from persisted config then proxies to the container', async () => {
    const { inst } = makeDO();
    await inst.startApp(baseOpts);
    await inst.stopApp(); // state=stopped but config persisted
    const fetchSpy = (inst as unknown as { containerFetch: jest.Mock }).containerFetch;
    const res = await inst.proxyRequest(new Request('https://x/path'));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
    expect((inst as unknown as { renewActivityTimeout: jest.Mock }).renewActivityTimeout).toHaveBeenCalled();
  });

  it('502s + flips to crashed + schedules restart on container error', async () => {
    const { inst, sql, ctx } = makeDO();
    jest.spyOn(inst, 'restartApp').mockResolvedValue({ state: 'running' });
    await inst.startApp(baseOpts);
    (inst as unknown as { containerFetch: jest.Mock }).containerFetch.mockRejectedValueOnce(
      new Error('upstream dead'),
    );
    const res = await inst.proxyRequest(new Request('https://x/'));
    expect(res.status).toBe(502);
    expect(sql!.meta.get('state')).toBe('crashed');
    expect(ctx.waitUntil).toHaveBeenCalled(); // auto-restart scheduled
  });

  it('502s when lazy boot itself fails', async () => {
    const { inst } = makeDO();
    await inst.startApp(baseOpts);
    await inst.stopApp();
    (inst as unknown as { startAndWaitForPorts: jest.Mock }).startAndWaitForPorts.mockRejectedValueOnce(
      new Error('boot fail'),
    );
    const res = await inst.proxyRequest(new Request('https://x/'));
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/boot failed/i);
  });
});

describe('AppRuntimeContainer — HTTP shim (fetch router)', () => {
  it('POST /start parses the body and boots', async () => {
    const { inst } = makeDO();
    const res = await inst.fetch(
      new Request('https://do/start', { method: 'POST', body: JSON.stringify(baseOpts) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'running' });
  });

  it('POST /stop returns stopped state', async () => {
    const { inst } = makeDO();
    await inst.startApp(baseOpts);
    const res = await inst.fetch(new Request('https://do/stop', { method: 'POST' }));
    expect(await res.json()).toEqual({ state: 'stopped' });
  });

  it('POST /restart errors (500 JSON) when never started', async () => {
    const { inst } = makeDO();
    const res = await inst.fetch(new Request('https://do/restart', { method: 'POST' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/never been started/);
  });

  it('GET /status returns the status snapshot', async () => {
    const { inst } = makeDO();
    const res = await inst.fetch(new Request('https://do/status'));
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe('idle');
  });

  it('GET /logs?tail=N returns the wrapped log lines', async () => {
    const { inst, sql } = makeDO();
    sql!.logs.push({ id: 1, ts: 5, stream: 'system', line: 'hi' });
    const res = await inst.fetch(new Request('https://do/logs?tail=5'));
    const body = (await res.json()) as { lines: Array<{ line: string }> };
    expect(body.lines[0].line).toBe('hi');
  });

  it('GET /logs/stream returns an SSE response', async () => {
    // Fake timers so the 15s heartbeat interval inside streamLogs() never
    // schedules a real timer that would leak as an open handle.
    jest.useFakeTimers();
    const { inst } = makeDO();
    const res = await inst.fetch(new Request('https://do/logs/stream'));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toMatch(/no-cache/);
    // Close the stream-backed body + clear any scheduled timers.
    await res.body?.cancel().catch(() => undefined);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('/proxy/* strips the prefix and proxies (lazy-boots from config)', async () => {
    const { inst } = makeDO();
    await inst.startApp(baseOpts);
    const fetchSpy = (inst as unknown as { containerFetch: jest.Mock }).containerFetch;
    const res = await inst.fetch(new Request('https://do/proxy/dashboard?q=1'));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('unknown path falls through to a direct container proxy', async () => {
    const { inst } = makeDO();
    await inst.startApp(baseOpts);
    const res = await inst.fetch(new Request('https://do/anything'));
    expect(res.status).toBe(200);
  });
});

describe('AppRuntimeContainer — container lifecycle hooks', () => {
  it('onStart flips to running and stamps bootedAt', async () => {
    const { inst, sql } = makeDO();
    await inst.onStart();
    const status = await inst.getStatus();
    expect(status.state).toBe('running');
    expect(sql!.logs.some((l) => /onStart/.test(l.line))).toBe(true);
  });

  it('onStop records exit code + reason and flips to stopped', async () => {
    const { inst, sql } = makeDO();
    await inst.onStop({ exitCode: 137, reason: 'OOM' });
    expect(sql!.meta.get('state')).toBe('stopped');
    expect(sql!.logs.some((l) => /exit=137 reason=OOM/.test(l.line))).toBe(true);
  });

  it('onError flips to crashed, persists last_error, and returns the error', () => {
    const { inst, sql } = makeDO();
    jest.spyOn(inst, 'restartApp').mockResolvedValue({ state: 'running' });
    const err = new Error('segfault');
    const returned = inst.onError(err);
    expect(returned).toBe(err);
    expect(sql!.meta.get('state')).toBe('crashed');
    expect(sql!.meta.get('last_error')).toBe('segfault');
  });

  it('onError coerces a non-Error thrown value to a string message', () => {
    const { inst, sql } = makeDO();
    jest.spyOn(inst, 'restartApp').mockResolvedValue({ state: 'running' });
    inst.onError('plain string failure');
    expect(sql!.meta.get('last_error')).toBe('plain string failure');
  });
});
