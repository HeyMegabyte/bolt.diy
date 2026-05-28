/**
 * @module services/worker_log_tail
 *
 * @description
 * Tail consumer for Worker logs. Receives the Cloudflare `TailEvent` array,
 * maps each log line to the `worker_logs` D1 schema, and batch-inserts.
 *
 * Cost estimation formula:
 *   cost_estimate = (duration_ms / 1000) * 0.00000003  // $0.03/million CPU-s approximation
 *                 + (response_bytes / 1048576) * 0.000000015  // egress estimate
 *
 * The tail consumer is a separate Worker export (`WorkerLogTailConsumer`)
 * wired via `wrangler.toml`:
 *   [[tail_consumers]]
 *   service = "project-sites-log-tail"
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';

// CF Worker Tail event shape (simplified)
export interface TailEvent {
  event: {
    request?: {
      method?: string;
      url?: string;
      headers?: Record<string, string>;
    };
    response?: { status?: number };
    cf?: {
      workersCPUTime?: number;
    };
  };
  logs: Array<{
    level?: string;
    message?: string[];
    timestamp?: number;
  }>;
  exceptions: Array<{
    name?: string;
    message?: string;
    timestamp?: number;
  }>;
  outcome?: string;
  executionModel?: string;
  eventTimestamp?: number;
  durationMs?: number;
}

export interface LogRow {
  id: string;
  ts: string;
  level: string;
  request_id: string;
  route: string;
  method: string;
  status: number | null;
  duration_ms: number | null;
  cost_estimate: number;
  message: string;
  meta_json: string;
}

/** Map a TailEvent to zero-or-more log rows. */
export function tailEventToRows(event: TailEvent): LogRow[] {
  const url = event.event?.request?.url ?? '';
  const route = extractRoute(url);
  const method = event.event?.request?.method ?? '';
  const status = event.event?.response?.status ?? null;
  const durationMs = event.durationMs ?? null;
  const costEstimate = estimateCost(durationMs, 0);
  const requestId = event.event?.request?.headers?.['x-request-id'] ?? crypto.randomUUID();
  const baseTs = event.eventTimestamp ? new Date(event.eventTimestamp).toISOString() : new Date().toISOString();

  const rows: LogRow[] = [];

  // One row per console log line
  for (const log of event.logs ?? []) {
    const message = (log.message ?? []).join(' ');
    const level = normaliseLevel(log.level ?? 'info');
    rows.push({
      id: crypto.randomUUID(),
      ts: log.timestamp ? new Date(log.timestamp).toISOString() : baseTs,
      level,
      request_id: requestId,
      route,
      method,
      status,
      duration_ms: durationMs,
      cost_estimate: costEstimate,
      message,
      meta_json: JSON.stringify({ outcome: event.outcome ?? 'ok', url }),
    });
  }

  // One row per exception
  for (const ex of event.exceptions ?? []) {
    const message = `${ex.name ?? 'Error'}: ${ex.message ?? ''}`.trim();
    rows.push({
      id: crypto.randomUUID(),
      ts: ex.timestamp ? new Date(ex.timestamp).toISOString() : baseTs,
      level: 'error',
      request_id: requestId,
      route,
      method,
      status,
      duration_ms: durationMs,
      cost_estimate: costEstimate,
      message,
      meta_json: JSON.stringify({ exception: true, outcome: event.outcome ?? 'exception', url }),
    });
  }

  // If no logs or exceptions, emit one summary row
  if (rows.length === 0) {
    const level = event.outcome === 'exception' ? 'error' : 'info';
    rows.push({
      id: crypto.randomUUID(),
      ts: baseTs,
      level,
      request_id: requestId,
      route,
      method,
      status,
      duration_ms: durationMs,
      cost_estimate: costEstimate,
      message: `${method} ${route} → ${status ?? '?'} (${durationMs ?? '?'}ms)`,
      meta_json: JSON.stringify({ outcome: event.outcome ?? 'ok' }),
    });
  }

  return rows;
}

/** Batch-insert log rows into D1, ignoring conflicts. */
export async function persistLogRows(env: Env, rows: LogRow[]): Promise<void> {
  if (rows.length === 0) return;

  const stmts = rows.map((row) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO worker_logs
         (id, ts, level, request_id, route, method, status, duration_ms, cost_estimate, message, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.id,
      row.ts,
      row.level,
      row.request_id,
      row.route,
      row.method,
      row.status,
      row.duration_ms,
      row.cost_estimate,
      row.message,
      row.meta_json,
    ),
  );

  await env.DB.batch(stmts);
}

/** Auto-prune rows older than 30 days. Call from a scheduled Cron. */
export async function pruneOldLogs(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `DELETE FROM worker_logs WHERE ts < datetime('now', '-30 days')`,
  ).run();
  return (result as unknown as { changes?: number }).changes ?? 0;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function extractRoute(url: string): string {
  try {
    const u = new URL(url);
    // Normalise dynamic segments: /api/sites/uuid → /api/sites/:id
    return u.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
      .replace(/\/\d{5,}/g, '/:id');
  } catch {
    return url.split('?')[0] ?? url;
  }
}

function normaliseLevel(raw: string): string {
  const map: Record<string, string> = {
    debug: 'debug', info: 'info', log: 'info', warn: 'warn',
    warning: 'warn', error: 'error', fatal: 'fatal',
  };
  return map[raw.toLowerCase()] ?? 'info';
}

function estimateCost(durationMs: number | null, responseBytes: number): number {
  const cpuCost = ((durationMs ?? 0) / 1000) * 0.00000003;
  const egressCost = (responseBytes / 1_048_576) * 0.000000015;
  return cpuCost + egressCost;
}
