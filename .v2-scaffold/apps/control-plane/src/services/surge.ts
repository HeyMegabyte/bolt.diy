/**
 * Surge transparency — backlog item #17.
 *
 * Computes a per-geohash surge multiplier from real-time demand (pending
 * bookings in the area) vs supply (online crew with last GPS inside the
 * geohash bounding box).
 *
 * @remarks
 * Demand/supply windows are last 15 minutes. Multiplier clamps to [1.0, 3.0].
 *
 * @example
 * ```ts
 * const s = await computeSurge(env, { geohash: 'dr5ru', tenantId });
 * // { multiplier: 1.4, demand_index: 12, supply_index: 8, reason: 'High demand' }
 * ```
 */

import type { Env } from '../env.js';
import { dbQueryOne } from './db.js';

export interface SurgeSnapshot {
  readonly geohash: string;
  readonly multiplier: number;
  readonly demand_index: number;
  readonly supply_index: number;
  readonly reason: string;
  readonly computed_at: string;
}

const MIN_MULTIPLIER = 1.0;
const MAX_MULTIPLIER = 3.0;
const WINDOW_MS = 15 * 60 * 1000;

/** Geohash → approximate lat/lng bounding box. Simplified base-32 decoder. */
export function geohashBounds(geohash: string): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let isEven = true;
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  for (const ch of geohash.toLowerCase()) {
    const idx = base32.indexOf(ch);
    if (idx === -1) continue;
    for (let i = 4; i >= 0; i--) {
      const bit = (idx >> i) & 1;
      if (isEven) {
        const mid = (minLng + maxLng) / 2;
        if (bit === 1) minLng = mid;
        else maxLng = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (bit === 1) minLat = mid;
        else maxLat = mid;
      }
      isEven = !isEven;
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

export async function computeSurge(
  env: Env,
  args: { geohash: string; tenantId?: string },
): Promise<SurgeSnapshot> {
  const bounds = geohashBounds(args.geohash);
  const windowIso = new Date(Date.now() - WINDOW_MS).toISOString();

  const demandRow = await dbQueryOne<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM jobs
      WHERE deleted_at IS NULL
        AND crew_id IS NULL
        AND status IN ('scheduled','pending')
        AND origin_lat IS NOT NULL AND origin_lng IS NOT NULL
        AND origin_lat BETWEEN ?1 AND ?2
        AND origin_lng BETWEEN ?3 AND ?4
        AND ( ?5 IS NULL OR tenant_id = ?5 )`,
    [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng, args.tenantId ?? null],
  );
  const supplyRow = await dbQueryOne<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM team_members
      WHERE deleted_at IS NULL
        AND role = 'crew'
        AND online_status = 'online'
        AND last_lat IS NOT NULL AND last_lng IS NOT NULL
        AND last_lat BETWEEN ?1 AND ?2
        AND last_lng BETWEEN ?3 AND ?4
        AND last_ping_at > ?5
        AND ( ?6 IS NULL OR tenant_id = ?6 )`,
    [
      bounds.minLat,
      bounds.maxLat,
      bounds.minLng,
      bounds.maxLng,
      windowIso,
      args.tenantId ?? null,
    ],
  );
  const demand = demandRow?.n ?? 0;
  const supply = supplyRow?.n ?? 0;

  const ratio = supply === 0 ? (demand === 0 ? 1 : MAX_MULTIPLIER) : demand / supply;
  const multiplier = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, 1 + (ratio - 1) * 0.6));
  const rounded = Math.round(multiplier * 10) / 10;

  const reason =
    rounded >= 2.0
      ? 'Severe demand — supply scarce'
      : rounded >= 1.5
        ? 'High demand — limited crew online'
        : rounded > 1.0
          ? 'Modest surge — busy period'
          : 'Normal pricing';

  return {
    geohash: args.geohash,
    multiplier: rounded,
    demand_index: demand,
    supply_index: supply,
    reason,
    computed_at: new Date().toISOString(),
  };
}
