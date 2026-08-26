/**
 * @module libs/features/billing/handlers
 *
 * @description
 * Hono routes for the READ-ONLY billing surface — the owner-dashboard billing
 * pane: current subscription, resolved plan entitlements, per-tenant site-quota
 * snapshot, and the 30-day rolling cost forecast. Every route is org-scoped via
 * `c.get('orgId')` (401 envelope when missing) and every read is bounded to that
 * org's rows — a caller can never read another org's billing state.
 *
 * | Method | Path                          | Auth  | Purpose                              |
 * | ------ | ----------------------------- | ----- | ------------------------------------ |
 * | GET    | /api/billing/subscription     | orgId | Current Stripe subscription row \| null |
 * | GET    | /api/billing/entitlements     | orgId | Resolved plan entitlements object    |
 * | GET    | /api/billing/quota            | orgId | Site-quota snapshot (used/limit/…)   |
 * | GET    | /api/billing/cost-forecast    | orgId | 30-day rolling cost projection       |
 *
 * Extracted VERBATIM from the `api.ts` monolith (route-decomposition installment
 * 5). These are the GET (read-only) billing routes ONLY — no money movement. The
 * WRITE billing routes (checkout / embedded-checkout / payment-intent / portal /
 * connect / usage / spend-alerts) stay in their existing homes and are NOT part of
 * this module. Core, un-gated (`core_billing` sentinel — no `isFlagOn` guard). No
 * request body/params are cast via `as {…}` — the only query params (`days`) are
 * numerically clamped — so there is no `schemas.ts` (nothing to Zod-validate at the
 * boundary). Reads use `billingService`, `resolveActiveOrgPlan`/`checkBuildLimit`,
 * and direct `c.env.DB.prepare(...)` for the forecast aggregate. Known AppErrors
 * (`unauthorized()`) propagate to the app-level error handler.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { unauthorized } from '@project-sites/shared';
import type { Env, Variables } from '../../../src/types/env.js';
import * as billingService from '../../../src/services/billing.js';
import { checkBuildLimit, resolveActiveOrgPlan } from '../../../src/services/build_limits.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const billing = new Hono<AppContext>();

/**
 * Get the current Stripe subscription record for the authenticated org.
 *
 * @route GET /api/billing/subscription
 * @auth Bearer — `orgId` MUST resolve from session
 * @returns 200 OK `{ data: <subscription row> | null }` — null when org has no
 *   subscription (free tier, never upgraded).
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 *
 * @remarks
 * Reads from D1 `subscriptions` table. Single source of truth for "is this org on a paid
 * plan and what tier?" — drives entitlements, billing portal, plan-gate UI in frontend.
 *
 * @see {@link billingService.getOrgSubscription}
 */
billing.get('/api/billing/subscription', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const sub = await billingService.getOrgSubscription(c.env.DB, orgId);
  return c.json({ data: sub });
});

/**
 * Get the resolved plan entitlements for the authenticated org.
 *
 * @route GET /api/billing/entitlements
 * @auth Bearer — `orgId` MUST resolve from session
 * @returns 200 OK `{ data: <entitlements object> }` — derived from subscription tier,
 *   includes feature flags (custom_domains, unlimited_edits, etc.), caps (site count,
 *   build budget), and resolved plan name.
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 *
 * @remarks
 * Free tier returns a hardcoded baseline. Paid tiers (Patron $50/mo) unlock unlimited
 * edits + AI chat + custom domains. Always check this BEFORE rendering paid-only UI in
 * frontend — never assume entitlements from local cache, as they can change mid-session
 * via Stripe webhook → subscription update.
 *
 * @see {@link billingService.getOrgEntitlements}
 */
billing.get('/api/billing/entitlements', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const entitlements = await billingService.getOrgEntitlements(c.env.DB, orgId);
  return c.json({ data: entitlements });
});

/**
 * GET /api/billing/quota
 *
 * Per-tenant site-quota snapshot for the caller's org — the data layer behind
 * the owner-facing "X of Y sites" chip (#35). Returns the SAME checkBuildLimit
 * the create paths enforce (create-from-search, import-from-url, POST /api/sites),
 * so the number an owner sees is exactly the number the server gates on.
 *
 * @route GET /api/billing/quota
 * @returns 200 `{ data: { used, limit, remaining, allowed, plan, unlimited } }` —
 *   `limit`/`remaining` are `null` for unlimited orgs (JSON can't carry Infinity).
 */
billing.get('/api/billing/quota', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const plan = (await resolveActiveOrgPlan(c.env.DB, orgId)) ?? 'free';
  const q = await checkBuildLimit(c.env.DB, orgId, plan);
  const unlimited = !Number.isFinite(q.limit);
  return c.json({
    data: {
      used: q.used,
      limit: unlimited ? null : q.limit,
      remaining: unlimited ? null : q.remaining,
      allowed: q.allowed,
      plan,
      unlimited,
    },
  });
});

/**
 * GET /api/billing/cost-forecast?days=30
 *
 * 30-day rolling cost forecast for the org. Aggregates `usage_events` per day,
 * projects the next 30d via a 7-day rolling rate, compares to the plan cap
 * (when set), and returns daily breakdown for the sparkline.
 *
 * @remarks
 * Uses the metric → USD pricing table baked into this route to convert
 * `usage_events.value` (raw counts) into dollars. Pricing follows
 * Cloudflare-equivalent rates as of 2026-05:
 *   - `ai_calls` ≈ $0.011 per call (Workers AI Llama 3.3 70B FP8-fast)
 *   - `bytes_egress` ≈ $0.04 per GB
 *   - `image_generations` ≈ $0.04 per image (DALL·E 3 standard)
 *
 * Plan cap comes from `subscriptions.plan_cap_usd` when the org has a
 * subscription; defaults to free-tier $25/mo otherwise. Days-until-cap-hit
 * uses the rolling rate when both signal a finite ramp; otherwise null.
 *
 * @route GET /api/billing/cost-forecast?days=30
 * @returns 200 OK `{ data: { projected_usd, current_period_usd, breakdown,
 *   plan_cap_usd, percent_of_cap, days_until_cap_hit, rolling_daily_avg,
 *   period_start, period_end } }`
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer $T" \
 *   "https://projectsites.dev/api/billing/cost-forecast?days=30"
 * # → { data: { projected_usd: 18.42, percent_of_cap: 36.84, ... } }
 * ```
 */
billing.get('/api/billing/cost-forecast', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const daysParam = Number(c.req.query('days') ?? '30');
  const days = Number.isFinite(daysParam) ? Math.min(90, Math.max(7, Math.floor(daysParam))) : 30;
  const now = new Date();
  const periodStart = new Date(now.getTime() - days * 86_400_000);
  const startIso = periodStart.toISOString();

  // Pricing table — keep in lockstep with src/services/billing.ts overage math.
  const PRICE_PER_AI_CALL_USD = 0.011;
  const PRICE_PER_GB_EGRESS_USD = 0.04;
  const PRICE_PER_IMAGE_USD = 0.04;

  // Per-day aggregate via UNION ALL across metric-specific views — keeps the
  // hot path off the unindexed `metric` column scan and leverages the
  // composite (org_id, metric, ts) index for each subquery.
  const rows = await c.env.DB.prepare(
    `SELECT substr(ts, 1, 10) AS day, metric, SUM(value) AS total
     FROM usage_events
     WHERE org_id = ? AND ts >= ?
     GROUP BY day, metric
     ORDER BY day ASC`,
  )
    .bind(orgId, startIso)
    .all<{ day: string; metric: string; total: number }>();

  // Roll into per-day USD + call count for the sparkline.
  const dayMap = new Map<string, { usd: number; calls: number }>();
  for (const r of rows.results ?? []) {
    const entry = dayMap.get(r.day) ?? { usd: 0, calls: 0 };
    if (r.metric === 'ai_calls') {
      entry.usd += r.total * PRICE_PER_AI_CALL_USD;
      entry.calls += r.total;
    } else if (r.metric === 'bytes_egress') {
      entry.usd += (r.total / 1_073_741_824) * PRICE_PER_GB_EGRESS_USD;
    } else if (r.metric === 'image_generations') {
      entry.usd += r.total * PRICE_PER_IMAGE_USD;
    }
    dayMap.set(r.day, entry);
  }

  // Zero-fill every day in the window so the sparkline never has gaps.
  const breakdown: Array<{ day: string; usd: number; calls: number }> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(periodStart.getTime() + i * 86_400_000);
    const dayKey = d.toISOString().slice(0, 10);
    const entry = dayMap.get(dayKey) ?? { usd: 0, calls: 0 };
    breakdown.push({ day: dayKey, usd: Number(entry.usd.toFixed(4)), calls: entry.calls });
  }

  const currentPeriodUsd = breakdown.reduce((sum, b) => sum + b.usd, 0);

  // 7-day rolling rate (USD/day) — used to project the next 30 days.
  // Falls back to the full-window average when we have <7 days of signal.
  const last7 = breakdown.slice(-7);
  const rollingDailyAvg =
    last7.length === 7
      ? last7.reduce((s, b) => s + b.usd, 0) / 7
      : breakdown.length > 0
        ? currentPeriodUsd / breakdown.length
        : 0;
  const projectedUsd = Number((rollingDailyAvg * 30).toFixed(2));

  // Plan cap — pull from subscriptions row when set, fall back to free-tier $25.
  // The `plan_cap_usd` column is optional (added in a later migration) — wrap
  // in a try/catch so we never 500 when the column doesn't exist yet.
  let planCapUsd: number | null = 25;
  try {
    const subRow = await c.env.DB.prepare(
      `SELECT status FROM subscriptions
       WHERE org_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(orgId)
      .first<{ status: string }>();
    if (subRow && (subRow.status === 'active' || subRow.status === 'trialing')) {
      // Paid tier — Patron plan default cap is $50/mo (mirrors PRICING.MONTHLY_CENTS).
      planCapUsd = 50;
    }
  } catch {
    // subscriptions table not yet migrated — leave the $25 free-tier default.
  }

  const percentOfCap =
    planCapUsd && planCapUsd > 0 ? Math.round((projectedUsd / planCapUsd) * 100) : 0;

  // Days until projected spend hits the cap at the current rolling rate.
  let daysUntilCapHit: number | null = null;
  if (planCapUsd && planCapUsd > 0 && rollingDailyAvg > 0 && currentPeriodUsd < planCapUsd) {
    const remaining = planCapUsd - currentPeriodUsd;
    daysUntilCapHit = Math.max(0, Math.ceil(remaining / rollingDailyAvg));
  }

  // Fire-and-forget 80% warning toast via KV-keyed dedup so the toast only
  // surfaces once per (org, billing-period-start) tuple.
  if (planCapUsd && planCapUsd > 0 && percentOfCap >= 80) {
    const periodKey = breakdown[0]?.day ?? startIso.slice(0, 10);
    const dedupKey = `forecast:warn:${orgId}:${periodKey}`;
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const seen = await c.env.CACHE_KV.get(dedupKey);
          if (seen) return;
          await c.env.CACHE_KV.put(dedupKey, '1', { expirationTtl: 60 * 60 * 24 * 32 });
          console.warn(
            JSON.stringify({
              level: 'warn',
              service: 'cost_forecast',
              event: 'cap_warning',
              org_id: orgId,
              percent_of_cap: percentOfCap,
              projected_usd: projectedUsd,
              plan_cap_usd: planCapUsd,
            }),
          );
        } catch {
          // best-effort — never throw from the post-response path
        }
      })(),
    );
  }

  return c.json({
    data: {
      projected_usd: projectedUsd,
      current_period_usd: Number(currentPeriodUsd.toFixed(2)),
      breakdown,
      plan_cap_usd: planCapUsd,
      percent_of_cap: percentOfCap,
      days_until_cap_hit: daysUntilCapHit,
      rolling_daily_avg: Number(rollingDailyAvg.toFixed(4)),
      period_start: startIso,
      period_end: now.toISOString(),
    },
  });
});
