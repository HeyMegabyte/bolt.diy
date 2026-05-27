/**
 * DispatchOptimizer — AI dispatch optimizer (backlog item #16).
 *
 * Runs `alarm()` every 30 seconds. Reads pending jobs from D1, available crew,
 * and greedily assigns crew→job by composite score:
 *   score = (1 / (haversine_km + 1)) * rating_factor
 * Higher score wins. Each crew member only gets one job per pass.
 *
 * Posts assignments to the JobTrackingHub so the customer's hero map updates
 * live, and persists the choice to `dispatch_assignments` for audit + offline
 * retraining of the heuristic.
 *
 * @remarks
 * One DO instance per tenant (idFromName(tenantId)). Hibernates between
 * 30-sec alarms. Errors auto-retry on next alarm — never throws past the
 * boundary.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.js';

interface PendingJobRow {
  id: string;
  tenant_id: string;
  origin_lat: number | null;
  origin_lng: number | null;
  status: string;
}

interface AvailableCrewRow {
  user_id: string;
  rating: number | null;
  last_lat: number | null;
  last_lng: number | null;
}

interface Assignment {
  jobId: string;
  crewId: string;
  distanceM: number;
  rating: number;
  score: number;
}

const ALARM_INTERVAL_MS = 30_000;
const EARTH_RADIUS_M = 6_371_008.8;

export class DispatchOptimizer extends DurableObject<Env> {
  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/kick' && req.method === 'POST') {
      // Caller (control-plane route) prods the optimizer when a new job lands.
      // The first kick persists the tenant_id so the alarm knows who to serve.
      try {
        const body = (await req.json().catch(() => ({}))) as { tenant_id?: string };
        if (body.tenant_id) {
          await this.ctx.storage.put('tenant_id', body.tenant_id);
        }
      } catch {
        // body parse failure shouldn't block scheduling
      }
      await this.scheduleNextAlarm();
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/status') {
      const nextAt = await this.ctx.storage.getAlarm();
      return Response.json({ next_alarm_at: nextAt });
    }

    return new Response('not found', { status: 404 });
  }

  override async alarm(): Promise<void> {
    try {
      await this.runOnce();
    } finally {
      // Always schedule the next alarm so the optimizer keeps ticking.
      await this.scheduleNextAlarm();
    }
  }

  private async scheduleNextAlarm(): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    const target = Date.now() + ALARM_INTERVAL_MS;
    if (current == null || current > target) {
      await this.ctx.storage.setAlarm(target);
    }
  }

  /** One greedy nearest-neighbor pass — public for tests. */
  async runOnce(): Promise<readonly Assignment[]> {
    // Tenant is encoded into the DO name; we read it from storage on first use.
    const tenantId = (await this.ctx.storage.get<string>('tenant_id')) ?? null;
    if (!tenantId) return [];

    const pendingRes = await this.env.DB.prepare(
      `SELECT id, tenant_id, origin_lat, origin_lng, status FROM jobs
        WHERE tenant_id = ?1
          AND deleted_at IS NULL
          AND crew_id IS NULL
          AND status IN ('scheduled','pending')
          AND origin_lat IS NOT NULL
          AND origin_lng IS NOT NULL
        ORDER BY scheduled_for ASC LIMIT 200`,
    )
      .bind(tenantId)
      .all<PendingJobRow>();
    const pending = pendingRes.results ?? [];

    const crewRes = await this.env.DB.prepare(
      `SELECT user_id, rating, last_lat, last_lng FROM team_members
        WHERE tenant_id = ?1
          AND role = 'crew'
          AND deleted_at IS NULL
          AND online_status = 'online'
          AND last_lat IS NOT NULL
          AND last_lng IS NOT NULL`,
    )
      .bind(tenantId)
      .all<AvailableCrewRow>();
    const crew = (crewRes.results ?? []).slice();

    const assignments: Assignment[] = [];
    const usedCrew = new Set<string>();

    for (const job of pending) {
      if (job.origin_lat == null || job.origin_lng == null) continue;
      let best: { crew: AvailableCrewRow; distanceM: number; score: number } | null = null;
      for (const c of crew) {
        if (usedCrew.has(c.user_id)) continue;
        if (c.last_lat == null || c.last_lng == null) continue;
        const distanceM = haversineMeters(
          job.origin_lat,
          job.origin_lng,
          c.last_lat,
          c.last_lng,
        );
        const ratingFactor = 0.5 + ((c.rating ?? 3.5) / 5);
        const score = (1 / (distanceM / 1000 + 1)) * ratingFactor;
        if (!best || score > best.score) {
          best = { crew: c, distanceM, score };
        }
      }
      if (!best) continue;
      assignments.push({
        jobId: job.id,
        crewId: best.crew.user_id,
        distanceM: best.distanceM,
        rating: best.crew.rating ?? 3.5,
        score: best.score,
      });
      usedCrew.add(best.crew.user_id);
    }

    if (assignments.length === 0) return [];

    const nowIso = new Date().toISOString();
    const statements = assignments.flatMap((a) => [
      this.env.DB.prepare(
        `UPDATE jobs SET crew_id = ?1, updated_at = ?2 WHERE id = ?3 AND crew_id IS NULL`,
      ).bind(a.crewId, nowIso, a.jobId),
      this.env.DB.prepare(
        `INSERT INTO dispatch_assignments (id, tenant_id, job_id, crew_id, distance_m, crew_rating, score, assigned_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        tenantId,
        a.jobId,
        a.crewId,
        a.distanceM,
        a.rating,
        a.score,
        nowIso,
      ),
    ]);
    await this.env.DB.batch(statements);

    // Fan out a status ping to each job's tracking hub so the customer's map
    // gets the "crew assigned" event without polling.
    for (const a of assignments) {
      const stub = this.env.JOB_TRACKING_HUB.get(
        this.env.JOB_TRACKING_HUB.idFromName(`${tenantId}:${a.jobId}`),
      );
      this.ctx.waitUntil(
        stub
          .fetch('https://do/ping', {
            method: 'POST',
            body: JSON.stringify({
              ts: Date.now(),
              lat: 0,
              lng: 0,
              status: 'en_route',
            }),
          })
          .catch(() => undefined),
      );
    }

    return assignments;
  }
}

/**
 * Haversine distance in meters. Numerically stable for short distances.
 *
 * @example
 * ```ts
 * haversineMeters(40.7128, -74.0060, 40.7580, -73.9855); // ~5570 m
 * ```
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}
