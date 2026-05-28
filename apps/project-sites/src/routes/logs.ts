/**
 * @module routes/logs
 *
 * @description
 * Worker Tail Log Explorer HTTP routes.
 *
 * Routes:
 *   POST /api/logs/search            Full-text + structured DSL search
 *   GET  /api/logs/cost-by-route     Aggregated cost by route for a time range
 *
 * Gated behind feature flag `log_explorer`. Returns 404 when off.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { unauthorized } from '@project-sites/shared';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { parseLogQuery, buildWhereClause } from '../services/log_query.js';

const logs = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── POST /api/logs/search ────────────────────────────────────────────────

const searchSchema = z.object({
  query: z.string().max(512).default(''),
  range: z.enum(['1h', '6h', '24h', '7d', '30d']).default('24h'),
  limit: z.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(), // ISO timestamp for keyset pagination
});

/**
 * Search Worker tail logs with the mini DSL.
 *
 * @example
 * ```json
 * { "query": "level:error AND route:/api/sites/* AND duration>2s", "range": "24h" }
 * ```
 */
logs.post('/api/logs/search', zValidator('json', searchSchema), async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const flagOn = await isFlagOn(c.env, 'log_explorer', { orgId });
  if (!flagOn) {
    return c.json({ error: { code: 'feature_disabled', message: 'Log explorer is not enabled.' } }, 404);
  }

  const { query, range, limit, cursor } = c.req.valid('json');
  const parsed = parseLogQuery(query);
  const { where, bindings } = buildWhereClause(parsed, range);

  // Keyset pagination: rows before the cursor timestamp
  let paginationClause = '';
  const allBindings: (string | number)[] = [...bindings];
  if (cursor) {
    paginationClause = where ? ' AND ts < ?' : 'WHERE ts < ?';
    allBindings.push(cursor);
  }

  const sql = `
    SELECT id, ts, level, request_id, route, method, status, duration_ms, cost_estimate, message, meta_json
    FROM worker_logs
    ${where}${paginationClause}
    ORDER BY ts DESC
    LIMIT ?
  `;
  allBindings.push(limit + 1); // fetch one extra to determine if there's a next page

  const stmt = c.env.DB.prepare(sql);
  const result = await stmt.bind(...allBindings).all<{
    id: string; ts: string; level: string; request_id: string;
    route: string; method: string; status: number | null;
    duration_ms: number | null; cost_estimate: number;
    message: string; meta_json: string;
  }>();

  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.ts ?? null : null;

  return c.json({
    data: {
      items: items.map((r) => ({
        ...r,
        meta: (() => { try { return JSON.parse(r.meta_json) as unknown; } catch { return {}; } })(),
      })),
      next_cursor: nextCursor,
      total_returned: items.length,
      query_parsed: parsed,
    },
  });
});

// ─── GET /api/logs/cost-by-route ─────────────────────────────────────────

const costByRouteSchema = z.object({
  range: z.enum(['1h', '6h', '24h', '7d', '30d']).default('24h'),
});

/**
 * Aggregate estimated cost by route for a time range.
 * Returns rows sorted by descending total cost.
 */
logs.get('/api/logs/cost-by-route', zValidator('query', costByRouteSchema), async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const flagOn = await isFlagOn(c.env, 'log_explorer', { orgId });
  if (!flagOn) {
    return c.json({ error: { code: 'feature_disabled', message: 'Log explorer is not enabled.' } }, 404);
  }

  const { range } = c.req.valid('query');
  const rangeMap: Record<string, string> = {
    '1h': '-1 hours', '6h': '-6 hours', '24h': '-24 hours',
    '7d': '-7 days', '30d': '-30 days',
  };
  const rangeExpr = rangeMap[range] ?? '-24 hours';

  const sql = `
    SELECT
      route,
      COUNT(*)                                       AS request_count,
      SUM(cost_estimate)                             AS total_cost,
      AVG(cost_estimate)                             AS avg_cost,
      AVG(duration_ms)                               AS avg_duration_ms,
      SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS error_count,
      MAX(duration_ms)                               AS max_duration_ms
    FROM worker_logs
    WHERE ts >= datetime('now', '${rangeExpr}')
    GROUP BY route
    ORDER BY total_cost DESC
    LIMIT 100
  `;

  const result = await c.env.DB.prepare(sql).all<{
    route: string; request_count: number; total_cost: number;
    avg_cost: number; avg_duration_ms: number; error_count: number;
    max_duration_ms: number;
  }>();

  const rows = result.results ?? [];
  const grandTotal = rows.reduce((s, r) => s + (r.total_cost ?? 0), 0);

  return c.json({
    data: {
      range,
      grand_total_cost: grandTotal,
      rows: rows.map((r) => ({
        ...r,
        cost_share_pct: grandTotal > 0 ? (r.total_cost / grandTotal) * 100 : 0,
      })),
    },
  });
});

export { logs };
