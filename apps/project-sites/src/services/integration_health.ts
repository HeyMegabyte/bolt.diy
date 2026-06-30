/**
 * @module services/integration_health
 * @description LOOP-NANGO-007 core — per-connection integration health scoring.
 * Pure functions that score API connection health from status signals.
 * Zero I/O.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── Connection status ──────────────────────────────────────────────────────

export const ConnectionHealth = z.enum([
  'healthy',
  'degraded',
  'failing',
  'disconnected',
  'unknown',
]);
export type ConnectionHealth = z.infer<typeof ConnectionHealth>;

// ── Connection signal ──────────────────────────────────────────────────────

export interface ConnectionSignal {
  /** Provider slug (e.g. 'stripe', 'github', 'mailchimp'). */
  provider: string;
  /** The last HTTP status from a health check (0 = never checked). */
  lastStatus: number;
  /** Whether the last token refresh succeeded. */
  tokenValid: boolean;
  /** Whether the most recent API call succeeded. */
  lastCallOk: boolean;
  /** Days since the connection was last used. */
  daysSinceLastUse: number;
  /** Whether the connection is configured (has credentials stored). */
  isConfigured: boolean;
}

// ── Scoring ────────────────────────────────────────────────────────────────

/**
 * Scores a single connection's health from observable signals. Pure.
 *
 * Rules:
 * - Not configured → `unknown`
 * - Token invalid → `failing`
 * - Last call failed + last status 4xx/5xx → `failing`
 * - Last status 5xx → `degraded`
 * - Last status 4xx → `degraded` (auth/config issue)
 * - Unused > 30 days → `degraded` (stale)
 * - All checks pass → `healthy`
 */
export function scoreConnectionHealth(signal: ConnectionSignal): ConnectionHealth {
  if (!signal.isConfigured) return 'unknown';
  if (!signal.tokenValid) return 'failing';
  if (!signal.lastCallOk && signal.lastStatus >= 400) return 'failing';
  if (signal.lastStatus >= 500) return 'degraded';
  if (signal.lastStatus >= 400) return 'degraded';
  if (signal.daysSinceLastUse > 30) return 'degraded';
  return 'healthy';
}

/**
 * Aggregates health across all connections. Returns counts per status
 * and an overall platform health level.
 */
export function aggregateConnectionHealth(connections: ConnectionSignal[]): {
  counts: Record<ConnectionHealth, number>;
  overall: ConnectionHealth;
  total: number;
} {
  const counts: Record<ConnectionHealth, number> = {
    healthy: 0,
    degraded: 0,
    failing: 0,
    disconnected: 0,
    unknown: 0,
  };

  for (const c of connections) {
    counts[scoreConnectionHealth(c)]++;
  }

  const total = connections.length;
  let overall: ConnectionHealth = 'healthy';
  if (counts.failing > 0) overall = 'failing';
  else if (counts.degraded > 0) overall = 'degraded';
  else if (counts.unknown === total && total > 0) overall = 'unknown';
  else if (counts.disconnected > 0) overall = 'degraded';

  return { counts, overall, total };
}
