/**
 * @module durable_objects/app_runtime
 *
 * @description
 * `AppRuntimeContainer` — Durable Object wrapping a Cloudflare Containers
 * (CFC) instance for a single deployed app from the `/admin/apps` catalog.
 *
 * One DO instance per `app_instances.id`. The DO:
 *  - Boots the container on first `proxyRequest` (lazy start), using the
 *    env vars + entrypoint declared by the catalog entry.
 *  - Persists last-known state, the env-var map, container image, port, and
 *    a 1000-line ring buffer of stdout/stderr to SQLite-backed DO storage.
 *  - Auto-restarts on crash, capped at 3 attempts per rolling minute.
 *  - Hibernates after 30 min of no requests via the parent `Container`'s
 *    `sleepAfter` mechanism.
 *  - Exposes RPC + HTTP surfaces consumed by `container_dispatcher.ts`.
 *
 * ## CFC dynamic-image caveat (***as of 2026-05***)
 *
 * Cloudflare Containers binds the image at `wrangler.toml` config time —
 * `image = "registry/name:tag" | "./Dockerfile"` per `[[containers]]`. The
 * `Container#start({ envVars, entrypoint, enableInternet })` API exposes
 * per-instance overrides for env + entrypoint + internet, but NOT for the
 * image itself. There is no runtime `docker pull` equivalent because the
 * container runs in CFC's sandboxed runc and the image must be present
 * before the DO ctor runs.
 *
 * Pragmatic path:
 *  1. This class is image-agnostic — the catalog `image` field is stored,
 *     but the actual image executed is whatever the wrangler `[[containers]]`
 *     block bound to `AppRuntimeContainer` declares.
 *  2. For the launch, the AppRuntimeContainer is bound to a minimal generic
 *     base ("scratch + busybox sh") which surfaces a "coming soon" page when
 *     a user tries to deploy an arbitrary image.
 *  3. To actually run a catalog app today, register a second DO class per
 *     top-10 image (e.g. `UmamiContainer extends AppRuntimeContainer`) — the
 *     base class already handles every lifecycle / log / proxy concern.
 *  4. When CFC ships dynamic-image support (tracked: cloudflare/workerd
 *     "container image at runtime" RFC), flip `start({ image, ... })` and
 *     drop the per-image subclasses without touching DO code.
 *
 * @packageDocumentation
 */

import { Container } from '@cloudflare/containers';
import type { Env } from '../types/env.js';

/** Container lifecycle states observable from the worker. */
export type AppRuntimeState =
  | 'idle'
  | 'booting'
  | 'running'
  | 'crashed'
  | 'stopped';

/** Options the dispatcher passes when first booting an instance. */
export interface AppRuntimeStartOpts {
  /** Container image ref (`registry/name:tag`). Stored, not yet dynamic. */
  readonly image: string;
  /** Default port the container listens on. */
  readonly port: number;
  /** Resolved env-var map (Postgres URL, Redis URL, secrets, app config). */
  readonly env: Readonly<Record<string, string>>;
  /** Persistent volume size hint, MiB. CFC honours via class config. */
  readonly volumeMB?: number;
  /** Optional entrypoint override (some images run a non-default cmd). */
  readonly entrypoint?: readonly string[];
}

/** Status snapshot returned to the admin UI. */
export interface AppRuntimeStatus {
  readonly state: AppRuntimeState;
  readonly uptime_seconds: number;
  readonly memory_mb_used: number;
  readonly last_error?: string;
  readonly restart_count: number;
  readonly image?: string;
}

/** Log line shape persisted in the ring buffer + streamed via SSE. */
interface LogLine {
  readonly ts: number;
  readonly stream: 'stdout' | 'stderr' | 'system';
  readonly line: string;
}

/** SQLite row shape — required for `ctx.storage.sql.exec<T>()` typing. */
interface LogRow {
  ts: number;
  stream: string;
  line: string;
  [key: string]: SqlStorageValue;
}

/** Inline schema kept in lockstep with `migrations/do-app-runtime-schema.sql`. */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_logs (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  stream TEXT    NOT NULL,
  line   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_logs_ts ON app_logs(ts DESC);
`;

const LOG_RING_LIMIT = 1000;
const RESTART_WINDOW_MS = 60_000;
const RESTART_MAX_PER_WINDOW = 3;

/**
 * Container-backed Durable Object running a single catalog app instance.
 *
 * @example
 * ```ts
 * // From the worker (via container_dispatcher.ts):
 * const stub = env.APP_RUNTIME.get(env.APP_RUNTIME.idFromName(instanceId));
 * await stub.start({ image: 'umami:postgresql-latest', port: 3000, env: {...} });
 * const res = await stub.proxyRequest(c.req.raw);
 * ```
 */
export class AppRuntimeContainer extends Container<Env> {
  /** Default port. Overridden per-instance by `start()`. */
  defaultPort = 3000;

  /** Hibernate after 30 min of idleness — keeps compute costs predictable. */
  override sleepAfter = '30m';

  /** Allow outbound internet (most apps need DBs, OAuth, webhooks). */
  override enableInternet = true;

  /** Schema-ready latch (per DO lifetime). */
  private schemaReady = false;

  /** In-memory mirror of state + boot timestamp for fast `getStatus`. */
  private liveState: AppRuntimeState = 'idle';
  private bootedAt = 0;
  private restartTimestamps: number[] = [];

  /** SSE writers fanning out new log lines. Cleared when client disconnects. */
  private logSubscribers = new Set<WritableStreamDefaultWriter<Uint8Array>>();

  // ── Schema + meta ─────────────────────────────────────────────────────

  private get appSql(): SqlStorage | null {
    const candidate = (this.ctx.storage as { sql?: SqlStorage }).sql;
    return candidate ?? null;
  }

  private ensureSchema(): void {
    if (this.schemaReady) return;
    this.appSql?.exec(SCHEMA_SQL);
    this.schemaReady = true;
  }

  private metaGet(key: string): string | null {
    if (!this.appSql) return null;
    const row = this.appSql
      .exec<{ value: string; [k: string]: SqlStorageValue }>(
        'SELECT value FROM app_meta WHERE key = ?',
        key,
      )
      .toArray()[0];
    return row?.value ?? null;
  }

  private metaSet(key: string, value: string): void {
    if (!this.appSql) return;
    this.appSql.exec(
      'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  // ── Log ring buffer ──────────────────────────────────────────────────

  private writeLog(stream: LogLine['stream'], line: string): void {
    this.ensureSchema();
    if (!this.appSql) return;
    const ts = Date.now();
    this.appSql.exec('INSERT INTO app_logs (ts, stream, line) VALUES (?, ?, ?)', ts, stream, line);
    // Trim ring buffer.
    this.appSql.exec(
      `DELETE FROM app_logs WHERE id NOT IN (
         SELECT id FROM app_logs ORDER BY ts DESC LIMIT ?
       )`,
      LOG_RING_LIMIT,
    );
    this.fanoutLog({ ts, stream, line });
  }

  private fanoutLog(entry: LogLine): void {
    if (this.logSubscribers.size === 0) return;
    const payload = `data: ${JSON.stringify(entry)}\n\n`;
    const bytes = new TextEncoder().encode(payload);
    for (const writer of this.logSubscribers) {
      writer.write(bytes).catch(() => {
        // Subscriber gone; drop on next tick.
        this.logSubscribers.delete(writer);
      });
    }
  }

  // ── Lifecycle (RPC surface) ──────────────────────────────────────────

  /**
   * Boot the container if not already running. Idempotent — repeated calls
   * with matching state return immediately. Named `startApp` (not `start`)
   * to avoid colliding with the parent `Container#start` signature.
   */
  async startApp(opts: AppRuntimeStartOpts): Promise<{ state: AppRuntimeState }> {
    this.ensureSchema();
    // Persist the catalog config so restart / proxy can read it without
    // round-tripping to D1.
    this.metaSet('image', opts.image);
    this.metaSet('port', String(opts.port));
    this.metaSet('env', JSON.stringify(opts.env));
    if (opts.entrypoint) this.metaSet('entrypoint', JSON.stringify(opts.entrypoint));

    if (this.liveState === 'running' || this.liveState === 'booting') {
      return { state: this.liveState };
    }

    this.liveState = 'booting';
    this.writeLog('system', `Booting container · image=${opts.image} port=${opts.port}`);
    try {
      await this.startAndWaitForPorts([opts.port], { portReadyTimeoutMS: 120_000 }, {
        envVars: opts.env as Record<string, string>,
        entrypoint: opts.entrypoint as string[] | undefined,
        enableInternet: this.enableInternet,
      });
      this.liveState = 'running';
      this.bootedAt = Date.now();
      this.metaSet('state', 'running');
      this.metaSet('booted_at', String(this.bootedAt));
      this.writeLog('system', 'Container port ready');
      return { state: 'running' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.liveState = 'crashed';
      this.metaSet('state', 'crashed');
      this.metaSet('last_error', msg);
      this.writeLog('stderr', `Boot failed: ${msg}`);
      throw err;
    }
  }

  /** Graceful container shutdown. SIGTERM, then state flip. */
  async stopApp(): Promise<{ state: AppRuntimeState }> {
    this.ensureSchema();
    try {
      await super.stop('SIGTERM');
    } catch {
      // Idempotent — container may already be stopped.
    }
    this.liveState = 'stopped';
    this.metaSet('state', 'stopped');
    this.writeLog('system', 'Container stopped');
    return { state: 'stopped' };
  }

  /** Stop + start in sequence. Reuses persisted opts when present. */
  async restartApp(): Promise<{ state: AppRuntimeState }> {
    this.ensureSchema();
    await this.stopApp();
    const image = this.metaGet('image');
    const port = this.metaGet('port');
    const envJson = this.metaGet('env');
    if (!image || !port || !envJson) {
      throw new Error('Cannot restart: container has never been started');
    }
    const entrypointRaw = this.metaGet('entrypoint');
    return this.startApp({
      image,
      port: Number(port),
      env: JSON.parse(envJson),
      entrypoint: entrypointRaw ? (JSON.parse(entrypointRaw) as string[]) : undefined,
    });
  }

  /**
   * Forward an inbound request to the container's exposed port. Lazy-boots
   * the container on first call. Streams the response body back unchanged.
   */
  async proxyRequest(req: Request): Promise<Response> {
    this.ensureSchema();
    // Lazy boot when state is idle/stopped but config exists.
    if (this.liveState !== 'running') {
      const image = this.metaGet('image');
      const port = this.metaGet('port');
      const envJson = this.metaGet('env');
      if (!image || !port || !envJson) {
        return new Response('App not provisioned. Run start() first.', { status: 503 });
      }
      try {
        await this.startApp({
          image,
          port: Number(port),
          env: JSON.parse(envJson),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(`Container boot failed: ${msg}`, { status: 502 });
      }
    }

    try {
      const port = Number(this.metaGet('port') ?? this.defaultPort);
      const res = await this.containerFetch(req, port);
      this.renewActivityTimeout();
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.writeLog('stderr', `Proxy error: ${msg}`);
      this.liveState = 'crashed';
      this.metaSet('state', 'crashed');
      this.metaSet('last_error', msg);
      this.maybeAutoRestart();
      return new Response(`Container error: ${msg}`, { status: 502 });
    }
  }

  /** Last N log lines from the ring buffer, newest last. */
  async getLogs(tail = 100): Promise<LogLine[]> {
    this.ensureSchema();
    if (!this.appSql) return [];
    const lim = Math.min(LOG_RING_LIMIT, Math.max(1, tail));
    const rows = this.appSql
      .exec<LogRow>('SELECT ts, stream, line FROM app_logs ORDER BY ts DESC LIMIT ?', lim)
      .toArray()
      .reverse();
    return rows.map((r) => ({
      ts: r.ts,
      stream: r.stream as LogLine['stream'],
      line: r.line,
    }));
  }

  /** Server-Sent-Events stream of new log lines. */
  async streamLogs(): Promise<Response> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    this.logSubscribers.add(writer);
    // Send the current tail first so the client has context.
    const tail = await this.getLogs(50);
    const init = tail.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    if (init) writer.write(new TextEncoder().encode(init));
    // Heartbeat every 15s so intermediaries don't close the connection.
    const heartbeat = setInterval(() => {
      writer.write(new TextEncoder().encode(': keepalive\n\n')).catch(() => {
        clearInterval(heartbeat);
        this.logSubscribers.delete(writer);
      });
    }, 15_000);
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  /** Synthetic status read by health endpoint + admin UI polling. */
  async getStatus(): Promise<AppRuntimeStatus> {
    this.ensureSchema();
    const uptime = this.bootedAt ? Math.floor((Date.now() - this.bootedAt) / 1000) : 0;
    return {
      state: this.liveState,
      uptime_seconds: uptime,
      // CFC does not expose per-container memory at runtime; surface 0 until
      // the Container#getMetrics API ships. UI treats 0 as "unknown".
      memory_mb_used: 0,
      last_error: this.metaGet('last_error') ?? undefined,
      restart_count: this.restartTimestamps.length,
      image: this.metaGet('image') ?? undefined,
    };
  }

  // ── HTTP shim ────────────────────────────────────────────────────────

  /**
   * HTTP entrypoint for callers that prefer URL routing over RPC (the
   * Workers DO bindings expose both). Routes:
   *
   *   POST /start             body = AppRuntimeStartOpts
   *   POST /stop
   *   POST /restart
   *   GET  /status
   *   GET  /logs?tail=N
   *   GET  /logs/stream       (SSE)
   *   *    /proxy/*           proxied to container port
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (request.method === 'POST' && path === '/start') {
        const body = (await request.json()) as AppRuntimeStartOpts;
        const r = await this.startApp(body);
        return Response.json(r);
      }
      if (request.method === 'POST' && path === '/stop') {
        return Response.json(await this.stopApp());
      }
      if (request.method === 'POST' && path === '/restart') {
        return Response.json(await this.restartApp());
      }
      if (request.method === 'GET' && path === '/status') {
        return Response.json(await this.getStatus());
      }
      if (request.method === 'GET' && path === '/logs') {
        const tail = Number(url.searchParams.get('tail') ?? '100');
        return Response.json({ lines: await this.getLogs(tail) });
      }
      if (request.method === 'GET' && path === '/logs/stream') {
        return this.streamLogs();
      }
      if (path.startsWith('/proxy')) {
        const inner = path.slice('/proxy'.length) || '/';
        const innerUrl = new URL(inner + url.search, url.origin);
        const newReq = new Request(innerUrl, request);
        return this.proxyRequest(newReq);
      }
      // Default: forward as-is to the container so callers can hit it
      // directly without the /proxy prefix.
      return this.proxyRequest(request);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── Crash recovery ───────────────────────────────────────────────────

  /** Track + cap restart attempts to avoid crash-loop billing storms. */
  private maybeAutoRestart(): void {
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restartTimestamps.length >= RESTART_MAX_PER_WINDOW) {
      this.writeLog(
        'system',
        `Auto-restart suppressed: ${RESTART_MAX_PER_WINDOW}/min cap hit`,
      );
      return;
    }
    this.restartTimestamps.push(now);
    this.writeLog('system', 'Auto-restart attempt scheduled');
    // Fire-and-forget — never block the failing request.
    this.ctx.waitUntil(
      this.restartApp().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.writeLog('stderr', `Auto-restart failed: ${msg}`);
      }),
    );
  }

  // ── Container lifecycle hooks ────────────────────────────────────────

  override async onStart(): Promise<void> {
    this.liveState = 'running';
    this.bootedAt = Date.now();
    this.writeLog('system', 'Container started (onStart)');
  }

  override async onStop(params: { exitCode: number; reason: string }): Promise<void> {
    this.liveState = 'stopped';
    this.metaSet('state', 'stopped');
    this.writeLog(
      'system',
      `Container stopped · exit=${params.exitCode} reason=${params.reason}`,
    );
  }

  override onError(error: unknown): unknown {
    const msg = error instanceof Error ? error.message : String(error);
    this.writeLog('stderr', `Container error: ${msg}`);
    this.liveState = 'crashed';
    this.metaSet('state', 'crashed');
    this.metaSet('last_error', msg);
    this.maybeAutoRestart();
    return error;
  }
}
