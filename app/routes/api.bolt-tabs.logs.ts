/**
 * @module api.bolt-tabs.logs
 *
 * Recent-log source for the bolt.diy editor "Logs" tab.
 *
 * The tab's client ({@link file://../components/workbench/extensions/tabs/LogsTab.tsx})
 * POLLS this endpoint every ~5s expecting `{ lines: LogLine[] }` and advances a
 * `since` cursor. This loader fulfils that contract by querying **Cloudflare
 * Workers Observability** (`/workers/observability/telemetry/query`) for the
 * deployed Worker's recent structured log events, filtered to the requested
 * project, and mapping each event to a `LogLine`.
 *
 * History: the previous implementation provisioned a CF **tail session** and
 * returned `{ tails: [...] }` — a key the client never reads (it reads
 * `data.lines`), so the tab was permanently empty. Worse, in prod the loader
 * 401'd because `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` were unset on the
 * Pages env, so it never worked at all. This version returns the shape the
 * client actually consumes, from a source that returns real lines over HTTP
 * (tail is WebSocket-only and un-pollable).
 *
 * Requires `CLOUDFLARE_API_TOKEN` (with **Workers Observability Read**) +
 * `CLOUDFLARE_ACCOUNT_ID` on `context.cloudflare.env`.
 *
 * @example
 * curl 'https://editor.projectsites.dev/api/bolt-tabs/logs?project=project-sites'
 */
import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';

interface CfEnv {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

/** One rendered log line — MUST match the client's `LogLine` interface. */
export interface LogLine {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
}

/** A single Workers-Observability event as returned by `view: 'events'`. */
export interface ObservabilityEvent {
  timestamp?: number;
  dataset?: string;
  source?: Record<string, unknown>;
}

interface CfEnvelope<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: T;
}

interface ObservabilityQueryResult {
  events?: { events?: ObservabilityEvent[] };
}

const CF_API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 30_000;

/** First poll (no cursor) looks back this far. */
const DEFAULT_WINDOW_MS = 5 * 60_000;

/** Hard cap on events per poll — the client keeps only the last 2000 anyway. */
const MAX_LINES = 200;
const VALID_LEVELS = new Set(['info', 'warn', 'error', 'debug']);

function readEnv(context: unknown): CfEnv {
  return (context as { cloudflare?: { env?: CfEnv } } | undefined)?.cloudflare?.env ?? {};
}

function fail(code: string, message: string, status: number): Response {
  const body: ErrorEnvelope = { error: { code, message } };

  return json(body, { status });
}

async function cfFetch<T>(url: string, init: RequestInit, token: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const data = (await res.json()) as CfEnvelope<T>;

    if (!res.ok || !data.success) {
      const msg = data.errors?.[0]?.message ?? `Cloudflare API error: ${res.status}`;
      throw new Error(msg);
    }

    return data.result as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Coerce an arbitrary structured-log `level` field to the client's enum,
 * defaulting to `info` for anything unrecognized (or missing).
 */
export function toLogLevel(value: unknown): LogLine['level'] {
  return typeof value === 'string' && VALID_LEVELS.has(value) ? (value as LogLine['level']) : 'info';
}

/**
 * CF automatically emits a bare per-request event (`{ level, message: 'GET
 * https://host/path' }`, `$metadata.type === 'cf-worker-event'`) for EVERY fetch,
 * which the app's own structured `http_request` log (`cf-worker`, carrying method
 * + path + status + durationMs) already covers — measured ~48% of the raw stream
 * is these mirrors, so the tab showed every request twice. Drop ONLY the bare
 * mirror: a request-shaped `message` with NO structured `method`/`msg`. Any
 * genuine plain-string app log (e.g. `console.error('payment failed')`) is kept.
 *
 * @param source - the `event.source` structured-fields object
 * @returns true if the event is a redundant CF request-mirror safe to drop
 * @example
 * isRedundantRequestMirror({ level: 'info', message: 'GET https://x/y' }) // true
 * isRedundantRequestMirror({ msg: 'http_request', method: 'GET', path: '/y' }) // false
 */
export function isRedundantRequestMirror(source: Record<string, unknown>): boolean {
  if (typeof source.method === 'string' || typeof source.msg === 'string') {
    return false;
  }

  const message = typeof source.message === 'string' ? source.message : '';

  return /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+https?:\/\//i.test(message);
}

/**
 * Map one Workers-Observability event to a `LogLine`. Pure + total: never
 * throws, always returns a renderable line. Prefers an HTTP-request summary
 * (`GET /path → 200 (12ms)`) when the event looks like a request log, else the
 * structured `msg`/`message`/`eventName`, else a truncated JSON of the source.
 *
 * @param event - one `result.events.events[]` entry
 * @param index - position in the batch, used to disambiguate the synthetic id
 * @returns a `LogLine` matching the LogsTab client contract
 * @example
 * mapEventToLogLine({ timestamp: 1, source: { level: 'info', method: 'GET', path: '/x', status: 200 } }, 0)
 * // → { id: '1-0-', timestamp: '1970-01-01T00:00:00.001Z', level: 'info', message: 'GET /x → 200', source: undefined }
 */
export function mapEventToLogLine(event: ObservabilityEvent, index: number): LogLine {
  const s = (event.source ?? {}) as Record<string, unknown>;
  const tsMs =
    typeof event.timestamp === 'number'
      ? event.timestamp
      : Number.isFinite(Date.parse(String(s.ts ?? '')))
        ? Date.parse(String(s.ts))
        : 0;
  const timestamp = new Date(tsMs).toISOString();
  const level = toLogLevel(s.level);

  let message: string;

  if (typeof s.method === 'string' && typeof s.path === 'string') {
    const status = s.status != null ? ` → ${String(s.status)}` : '';
    const dur = s.durationMs != null ? ` (${String(s.durationMs)}ms)` : '';
    message = `${s.method} ${s.path}${status}${dur}`;
  } else if (typeof s.msg === 'string' && s.msg) {
    message = s.msg;
  } else if (typeof s.message === 'string' && s.message) {
    message = s.message;
  } else if (typeof s.eventName === 'string' && s.eventName) {
    message = s.eventName;
  } else {
    message = JSON.stringify(s).slice(0, 500);
  }

  const scope = typeof s.scope === 'string' ? s.scope : typeof s.service === 'string' ? s.service : undefined;
  const line: LogLine = {
    id: `${tsMs}-${index}-${typeof s.requestId === 'string' ? s.requestId : ''}`,
    timestamp,
    level,
    message,
  };

  if (scope) {
    line.source = scope;
  }

  return line;
}

/**
 * Build the Workers-Observability telemetry query body for one poll: recent
 * events for a single Worker script, newest-window first, filtered by service.
 *
 * @param project - the Worker script / service name to tail
 * @param fromMs - window start (Unix ms)
 * @param toMs - window end (Unix ms)
 * @param limit - max events to return
 * @returns the JSON body for POST `/workers/observability/telemetry/query`
 * @example
 * buildObservabilityQuery('project-sites', 1000, 2000, 50).parameters.filters[0].value // 'project-sites'
 */
export function buildObservabilityQuery(project: string, fromMs: number, toMs: number, limit: number) {
  return {
    queryId: 'bolt-logs',
    timeframe: { from: fromMs, to: toMs },
    limit,
    parameters: {
      datasets: ['cloudflare-workers'],
      filters: [{ key: '$metadata.service', operation: 'eq', value: project, type: 'string' }],
    },
    view: 'events',
  };
}

/**
 * Compute the query window for a poll. Without a cursor, look back
 * {@link DEFAULT_WINDOW_MS}; with one, start 1ms after it to avoid re-emitting
 * the boundary event (the client de-dupes only by React key, so overlap shows
 * duplicates). Clamped so `from < to` even for a future/garbage cursor.
 *
 * @param since - the client's last-seen ISO timestamp, or null on first poll
 * @param nowMs - current Unix ms (injected for testability)
 * @returns `{ fromMs, toMs }` window bounds
 */
export function computeWindow(since: string | null, nowMs: number): { fromMs: number; toMs: number } {
  const toMs = nowMs;
  const parsed = since ? Date.parse(since) : NaN;
  const fromMs = Number.isFinite(parsed) ? Math.min(parsed + 1, toMs - 1) : toMs - DEFAULT_WINDOW_MS;

  return { fromMs, toMs };
}

/** Sort mapped lines oldest→newest so the client's append+cursor logic is correct. */
export function sortLinesAscending(lines: LogLine[]): LogLine[] {
  return [...lines].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}

export async function loader({ request, context }: LoaderFunctionArgs): Promise<Response> {
  const env = readEnv(context);
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;

  if (!token || !accountId) {
    return fail('missing_credentials', 'Cloudflare API token or account ID not configured', 401);
  }

  const url = new URL(request.url);
  const project = url.searchParams.get('project');

  if (!project) {
    return fail('missing_param', 'project query param is required', 400);
  }

  const { fromMs, toMs } = computeWindow(url.searchParams.get('since'), Date.now());
  const queryUrl = `${CF_API}/accounts/${encodeURIComponent(accountId)}/workers/observability/telemetry/query`;
  const body = JSON.stringify(buildObservabilityQuery(project, fromMs, toMs, MAX_LINES));

  try {
    const result = await cfFetch<ObservabilityQueryResult>(queryUrl, { method: 'POST', body }, token);
    const events = (result?.events?.events ?? []).filter(
      (e) => !isRedundantRequestMirror((e.source ?? {}) as Record<string, unknown>),
    );
    const lines = sortLinesAscending(events.map(mapEventToLogLine));

    return json({ project, lines });
  } catch (error) {
    console.warn('[api.bolt-tabs.logs] observability query failed', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    return fail('cloudflare_error', message, 502);
  }
}
