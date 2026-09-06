/**
 * @module services/activation_funnel_query
 *
 * @description
 * The I/O layer over the `activation_funnel` Tinybird pipe (§9). Keeps the pure
 * funnel SSOT ({@link activation_funnel.ts}) free of network/clock — this module
 * does the read and the fail-soft shaping the admin endpoint needs.
 *
 * Fail-soft: when Tinybird is unconfigured OR the read fails, return a ZERO
 * funnel (every {@link ACTIVATION_STAGES} stage at 0) instead of an error — the
 * activation dashboard always renders the four stages, even before Tinybird is
 * live or during an outage. Only `degraded` flags the difference.
 *
 * @see services/activation_funnel.ts (the stage SSOT)
 * @see tinybird/pipes/activation_funnel.pipe
 */

import type { Env } from '../types/env.js';
import { queryTinybirdPipe } from './tinybird.js';
import { ACTIVATION_STAGES } from './activation_funnel.js';

/** One funnel stage row as returned by the pipe (or the zero fallback). */
export interface ActivationFunnelRow {
  /** The stage's bus event type (`lead.discovered`, …). */
  stage: string;
  /** Human label (`Discovered`, `Engaged`, `Delivered`, `Converted`). */
  label: string;
  /** Funnel position, 0 = top. */
  ordinal: number;
  /** DISTINCT events at this stage in the window. */
  events: number;
  /** DISTINCT sites at this stage in the window. */
  sites: number;
}

/** Result of {@link fetchActivationFunnel}. */
export interface ActivationFunnelResult {
  /** Stages in funnel order (top → bottom), always all {@link ACTIVATION_STAGES}. */
  stages: ActivationFunnelRow[];
  /** True when the data is the zero fallback (Tinybird unconfigured or read failed). */
  degraded: boolean;
}

/** Raw row shape the pipe emits (counts arrive as strings or numbers from TB). */
interface PipeRow {
  stage?: string;
  ordinal?: number | string;
  events?: number | string;
  sites?: number | string;
}

function toNum(v: number | string | undefined): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? (n as number) : 0;
}

/** The zero funnel — every stage at 0 (for unconfigured/degraded reads). */
function zeroFunnel(): ActivationFunnelRow[] {
  return ACTIVATION_STAGES.map((s) => ({
    stage: s.event,
    label: s.label,
    ordinal: s.ordinal,
    events: 0,
    sites: 0,
  }));
}

/**
 * Read the per-tenant activation funnel. Always returns all four stages in order;
 * stages the pipe didn't report (no events yet) come back at 0. Never throws.
 *
 * @param env - Worker env.
 * @param opts - `{ tenantId?, days? }` — narrows the pipe query.
 * @param deps - Optional `{ fetchImpl }` for tests.
 * @returns An {@link ActivationFunnelResult} (`degraded:true` on the zero fallback).
 * @example
 * const { stages, degraded } = await fetchActivationFunnel(env, { tenantId, days: 30 });
 */
export async function fetchActivationFunnel(
  env: Env,
  opts: { tenantId?: string; days?: number } = {},
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<ActivationFunnelResult> {
  const res = await queryTinybirdPipe<PipeRow>(
    env,
    'activation_funnel',
    { tenant_id: opts.tenantId, days: opts.days },
    deps,
  );
  if (!res.ok) return { stages: zeroFunnel(), degraded: true };

  // The pipe GROUPs BY tenant_id, so a GLOBAL query (no tenant_id) returns one row
  // PER (tenant, stage). SUM per stage across tenants — event_id + site_id are each
  // unique to a single tenant, so summing per-tenant DISTINCT counts equals the
  // global DISTINCT total. (A prior last-wins `set` here silently collapsed the
  // global funnel to ONE arbitrary tenant's count — masked while Tinybird was empty,
  // exposed by the AL-051 backfill: 103 published sites read as Delivered=2.)
  const byStage = new Map<string, { events: number; sites: number }>();
  for (const row of res.data) {
    if (!row.stage) continue;
    const agg = byStage.get(row.stage) ?? { events: 0, sites: 0 };
    agg.events += toNum(row.events);
    agg.sites += toNum(row.sites);
    byStage.set(row.stage, agg);
  }
  const stages = ACTIVATION_STAGES.map((s) => {
    const agg = byStage.get(s.event);
    return {
      stage: s.event,
      label: s.label,
      ordinal: s.ordinal,
      events: agg?.events ?? 0,
      sites: agg?.sites ?? 0,
    };
  });
  return { stages, degraded: false };
}
