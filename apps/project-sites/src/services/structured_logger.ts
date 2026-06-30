/**
 * @module services/structured_logger
 * @description LOOP-LOGS-001 core — structured log envelope builder with
 * enforced correlation-id schema. Pure functions that construct the canonical
 * log shape every handler, job, and cron MUST use.
 *
 * The actual `console.log(JSON.stringify(...))` lives in the call site —
 * this module only builds the validated shape.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── Log level ──────────────────────────────────────────────────────────────

export const LogLevel = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
export type LogLevel = z.infer<typeof LogLevel>;

// ── Canonical log envelope ─────────────────────────────────────────────────

export const LogEntrySchema = z.object({
  /** Severity level. */
  level: LogLevel,
  /** Unix ms timestamp. */
  ts: z.number().int().positive(),
  /** Human-readable message. */
  msg: z.string().min(1).max(1000),
  /** Trace correlation ID (from request middleware or minted fresh). */
  traceId: z.string().min(1),
  /** Cloudflare request ID or equivalent. */
  requestId: z.string().min(1),
  /** Worker / service identifier. */
  workerId: z.string().min(1),
  /** Environment: production | preview | development. */
  env: z.enum(['production', 'preview', 'development']),
  /** Optional duration in milliseconds. */
  durationMs: z.number().finite().nonnegative().optional(),
  /** Optional error payload (safe — no raw stacks in prod). */
  error: z
    .object({
      message: z.string().max(500),
      code: z.string().max(64).optional(),
    })
    .optional(),
  /** Tenant context (org ID, never PII). */
  tenantId: z.string().optional(),
  /** Route or handler path. */
  path: z.string().max(256).optional(),
  /** HTTP status code. */
  status: z.number().int().min(100).max(599).optional(),
  /** HTTP method. */
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).optional(),
  /** Arbitrary safe metadata (no PII, no secrets). */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

// ── Builder ────────────────────────────────────────────────────────────────

/** Required fields for building a log entry. */
export interface LogEntryParams {
  level: LogLevel;
  msg: string;
  traceId: string;
  requestId: string;
  workerId: string;
  env: 'production' | 'preview' | 'development';
  ts?: number;
  durationMs?: number;
  error?: { message: string; code?: string };
  tenantId?: string;
  path?: string;
  status?: number;
  method?: LogEntry['method'];
  meta?: Record<string, unknown>;
}

/**
 * Builds a validated structured log entry. Pure — caller passes `ts` for
 * determinism. The caller is responsible for `console.log(JSON.stringify(...))`.
 *
 * @param params - Required and optional log fields.
 * @returns A validated LogEntry ready for serialization.
 */
export function buildLogEntry(params: LogEntryParams): LogEntry {
  return LogEntrySchema.parse({
    level: params.level,
    ts: params.ts ?? Date.now(),
    msg: params.msg,
    traceId: params.traceId,
    requestId: params.requestId,
    workerId: params.workerId,
    env: params.env,
    durationMs: params.durationMs,
    error: params.error,
    tenantId: params.tenantId,
    path: params.path,
    status: params.status,
    method: params.method,
    meta: params.meta,
  });
}

/**
 * Serializes a log entry to a JSON string — the canonical wire format.
 * Pure — same entry always produces the same string.
 */
export function serializeLogEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

// ── Sentry severity mapping ────────────────────────────────────────────────

/** Maps log level to Sentry severity number. */
const SENTRY_SEVERITY: Record<LogLevel, number> = {
  trace: 5,
  debug: 7,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

/**
 * Returns the Sentry severity integer for a log level.
 * Pure lookup — always deterministic.
 */
export function logLevelToSentrySeverity(level: LogLevel): number {
  return SENTRY_SEVERITY[level];
}
