/**
 * @module services/analytics_query
 *
 * @description
 * Thin fail-soft reader for the raw-rollup Tinybird pipes (events_by_tenant_daily,
 * site_publishes_by_source). Wraps {@link queryTinybirdPipe} and maps its typed
 * result to `{ rows, degraded }` — `degraded:true` (empty rows) whenever Tinybird
 * is unconfigured or the read fails, so admin endpoints render a zero-state
 * instead of 5xx-ing. Unlike {@link fetchActivationFunnel} (which projects onto a
 * canonical stage set), these pipes return raw grouped rows passed straight
 * through. Reused by every rollup endpoint — one read-and-degrade definition.
 *
 * @see services/tinybird.ts (queryTinybirdPipe — the read seam)
 * @see tinybird/pipes/events_by_tenant_daily.pipe
 * @see tinybird/pipes/site_publishes_by_source.pipe
 */

import type { Env } from '../types/env.js';
import { queryTinybirdPipe } from './tinybird.js';

/** A row from `events_by_tenant_daily` (per-tenant/day/type event counts). */
export interface EventsDailyRow {
  tenant_id: string;
  day: string;
  event: string;
  events: number;
}

/** A row from `site_publishes_by_source` (per-tenant/day publish counts by source). */
export interface PublishesBySourceRow {
  tenant_id: string;
  day: string;
  source: string;
  publishes: number;
}

/** Result of a rollup read — the rows, plus whether the data is the degraded zero-state. */
export interface PipeReadResult<T> {
  rows: T[];
  /** True when Tinybird was unconfigured OR the read failed (rows is then `[]`). */
  degraded: boolean;
}

/**
 * Read a raw-rollup pipe, fail-soft. Drops undefined/empty params (handled by the
 * read seam). Never throws.
 *
 * @param env - Worker env.
 * @param pipe - Pipe name (no `.json` suffix).
 * @param params - Pipe query params (`tenant_id`, `days`, `event`, `source`, …).
 * @param deps - Optional `{ fetchImpl }` for tests.
 * @returns `{ rows, degraded }` — `rows:[]` + `degraded:true` on any non-ok read.
 * @example
 * const { rows, degraded } = await fetchPipeRows<EventsDailyRow>(env, 'events_by_tenant_daily', { tenant_id, days: 30 });
 */
export async function fetchPipeRows<T>(
  env: Env,
  pipe: string,
  params: Record<string, string | number | undefined> = {},
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<PipeReadResult<T>> {
  const res = await queryTinybirdPipe<T>(env, pipe, params, deps);
  return { rows: res.ok ? res.data : [], degraded: !res.ok };
}
