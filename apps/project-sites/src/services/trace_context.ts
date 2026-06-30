/**
 * @module services/trace_context
 * @description LOOP-TRACES-001 core — trace-context propagation primitives.
 * Pure helpers for W3C Trace Context (traceparent/tracestate) header
 * generation and parsing. Zero I/O.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── W3C traceparent ────────────────────────────────────────────────────────

/** W3C traceparent header value. */
export const TraceParentSchema = z
  .string()
  .regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/, 'Invalid W3C traceparent format');
export type TraceParent = z.infer<typeof TraceParentSchema>;

/** Extracted trace + span IDs from a traceparent. */
export interface TraceIds {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

// ── Builders ───────────────────────────────────────────────────────────────

/**
 * Generates a fresh W3C traceparent header value. Pure — caller provides
 * the hex trace/span IDs (from `crypto.randomUUID().replace(/-/g, '')`).
 *
 * @param traceIdHex - 32-char hex trace ID.
 * @param spanIdHex - 16-char hex span ID.
 * @param sampled - Whether this trace is sampled (default true).
 * @returns A valid traceparent string.
 */
export function buildTraceParent(traceIdHex: string, spanIdHex: string, sampled = true): string {
  const flag = sampled ? '01' : '00';
  const tp = `00-${traceIdHex}-${spanIdHex}-${flag}`;
  return TraceParentSchema.parse(tp);
}

/**
 * Parses a W3C traceparent header into its components.
 * Returns null for invalid/missing headers.
 */
export function parseTraceParent(header: string | null | undefined): TraceIds | null {
  if (!header) return null;

  const result = TraceParentSchema.safeParse(header);
  if (!result.success) return null;

  const parts = header.split('-');
  return {
    traceId: parts[1],
    spanId: parts[2],
    sampled: parts[3] === '01',
  };
}

// ── tracestate helpers ─────────────────────────────────────────────────────

/** Vendor key-value pairs in tracestate. */
export interface TraceStateEntry {
  vendor: string;
  key: string;
  value: string;
}

/**
 * Parses a W3C tracestate header into vendor entries.
 * Empty/missing → empty array. Malformed entries are silently dropped.
 */
export function parseTraceState(header: string | null | undefined): TraceStateEntry[] {
  if (!header) return [];

  return header
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): TraceStateEntry | null => {
      const eqIdx = entry.indexOf('=');
      if (eqIdx === -1) return null;
      const value = entry.slice(eqIdx + 1);
      const vendorKey = entry.slice(0, eqIdx);
      const atIdx = vendorKey.indexOf('@');
      if (atIdx === -1) return null;
      return {
        vendor: vendorKey.slice(0, atIdx),
        key: vendorKey.slice(atIdx + 1),
        value,
      };
    })
    .filter((e): e is TraceStateEntry => e !== null);
}

/**
 * Builds a tracestate header value from vendor entries.
 */
export function buildTraceState(entries: TraceStateEntry[]): string {
  return entries.map((e) => `${e.vendor}@${e.key}=${e.value}`).join(',');
}

// ── Trace ID generation (deterministic — caller provides source) ───────────

/**
 * Converts a standard UUID (with dashes) to a 32-char hex string suitable
 * for W3C traceparent. Pure string transformation.
 */
export function uuidToTraceHex(uuid: string): string {
  return uuid.replace(/-/g, '');
}

/**
 * Derives a 16-char span ID from a parent trace ID. Pure, deterministic —
 * takes the last 16 chars of the 32-char hex trace-id.
 */
export function deriveSpanId(traceIdHex: string): string {
  return traceIdHex.slice(-16);
}
