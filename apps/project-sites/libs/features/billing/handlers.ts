/**
 * @module libs/features/billing/handlers
 *
 * @description
 * Hono routes for the org-scoped billing surface — the owner-dashboard billing
 * pane (subscription, resolved plan entitlements, per-tenant site-quota snapshot,
 * 30-day rolling cost forecast) plus the billing-ADMIN writes (Stripe Connect
 * onboarding, usage metering, spend-alert CRUD). Every route is org-scoped via
 * `c.get('orgId')` (401 envelope when missing) and every read/write is bounded to
 * that org's rows — a caller can never touch another org's billing state.
 *
 * | Method | Path                             | Auth  | Purpose                              |
 * | ------ | -------------------------------- | ----- | ------------------------------------ |
 * | GET    | /api/billing/subscription        | orgId | Current Stripe subscription row \| null |
 * | GET    | /api/billing/entitlements        | orgId | Resolved plan entitlements object    |
 * | GET    | /api/billing/quota               | orgId | Site-quota snapshot (used/limit/…)   |
 * | GET    | /api/billing/cost-forecast       | orgId | 30-day rolling cost projection       |
 * | POST   | /api/billing/connect/start       | orgId | Start Stripe Connect onboarding      |
 * | GET    | /api/billing/connect/status      | orgId | Connect account charges/payouts state|
 * | POST   | /api/billing/connect/disconnect  | orgId | Disconnect the Connect account       |
 * | POST   | /api/billing/usage               | orgId | Internal record-a-usage-event        |
 * | GET    | /api/billing/usage/this-month    | orgId | Usage panel payload for the org      |
 * | POST   | /api/billing/spend-alerts        | orgId | Create a spend alert rule            |
 * | GET    | /api/billing/spend-alerts        | orgId | List the org's spend alerts          |
 * | DELETE | /api/billing/spend-alerts/:id    | orgId | Soft-delete a spend alert            |
 * | POST   | /api/billing/checkout            | orgId | Stripe Checkout session (redirect)   |
 * | POST   | /api/billing/embedded-checkout   | orgId | Stripe embedded Checkout (in-page)   |
 * | POST   | /api/billing/payment-intent      | orgId | Stripe PaymentIntent (inline 1-click)|
 * | POST   | /api/billing/portal              | orgId | Stripe billing-portal session        |
 *
 * Extracted VERBATIM from the `api.ts` monolith (route-decomposition installments
 * 5 + 7 + 8). Installment 5 brought the GET (read-only) billing reads; installment 7
 * added the billing-ADMIN write routes (Stripe Connect onboarding/status/disconnect,
 * usage metering record + panel, and spend-alert CRUD); installment 8 adds the
 * checkout-core money paths (checkout / embedded-checkout / payment-intent / portal),
 * so this module now owns ALL billing routes. Core, un-gated (`core_billing`
 * sentinel — no `isFlagOn` guard). Request bodies are read via
 * `c.req.json().catch(() => ({}))`; spend-alert creation validates via the shared
 * `createSpendAlertSchema` (dynamically imported), the checkout-core money paths
 * validate via the shared `createCheckoutSessionSchema` / `createEmbeddedCheckoutSchema`
 * / `createPaymentIntentSchema`, and the rest read narrow ad-hoc shapes. Reads/writes
 * use `billingService`, `resolveActiveOrgPlan`/`checkBuildLimit`, `connectService`,
 * `usageMetering`, the shared `dbQuery`/`dbQueryOne`/`dbInsert` helpers,
 * `auditService.writeAuditLog`, `posthog.trackSite` (fire-and-forget checkout events),
 * and direct `c.env.DB.prepare(...)` for the forecast aggregate + spend-alert delete.
 * Known AppErrors (`unauthorized()`, `badRequest()`, `forbidden()`, `notFound()`)
 * propagate to the app-level error handler.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import {
  DOMAINS,
  badRequest,
  forbidden,
  notFound,
  unauthorized,
  createCheckoutSessionSchema,
  createEmbeddedCheckoutSchema,
  createPaymentIntentSchema,
} from '@project-sites/shared';
import type { Env, Variables } from '../../../src/types/env.js';
import * as auditService from '../../../src/services/audit.js';
import * as billingService from '../../../src/services/billing.js';
import { dbInsert, dbQuery, dbQueryOne } from '../../../src/services/db.js';
import { checkBuildLimit, resolveActiveOrgPlan } from '../../../src/services/build_limits.js';
import * as connectService from '../../../src/services/stripe_connect.js';
import * as usageMetering from '../../../src/services/usage_metering.js';
import * as posthog from '../../../src/lib/posthog.js';

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

// Customer-side payments: each org connects their own Stripe account through
// our platform and we keep a 1.5% platform fee. See services/stripe_connect.ts.

/**
 * @route POST /api/billing/connect/start
 * @auth Bearer — orgId required.
 * @returns `{ data: { url, account_id } }` — redirect URL for Stripe onboarding.
 */
billing.post('/api/billing/connect/start', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) throw unauthorized('Must be authenticated');

  const user = await dbQueryOne<{ email: string | null }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  );
  if (!user?.email) throw badRequest('User has no email on file');

  const body = (await c.req.json().catch(() => ({}))) as {
    refresh_url?: string;
    return_url?: string;
  };
  const refreshUrl =
    body.refresh_url ?? `https://${DOMAINS.SITES_BASE}/admin/billing?connect=refresh`;
  const returnUrl = body.return_url ?? `https://${DOMAINS.SITES_BASE}/admin/billing?connect=done`;

  const result = await connectService.startConnectOnboarding(c.env, c.env.DB, {
    orgId,
    email: user.email,
    refreshUrl,
    returnUrl,
  });

  await auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'billing.connect.started',
      message: `Stripe Connect onboarding started for org '${orgId}'`,
      target_type: 'org',
      target_id: orgId,
      metadata_json: { account_id: result.account_id },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({ data: result });
});

/**
 * @route GET /api/billing/connect/status
 * @auth Bearer — orgId required.
 * @returns `{ data: { connected, charges_enabled, payouts_enabled, dashboard_url } }`
 */
billing.get('/api/billing/connect/status', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const status = await connectService.getConnectStatus(c.env, c.env.DB, orgId);
  return c.json({ data: status });
});

/**
 * @route POST /api/billing/connect/disconnect
 * @auth Bearer — orgId required.
 */
billing.post('/api/billing/connect/disconnect', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) throw unauthorized('Must be authenticated');

  const result = await connectService.disconnectConnect(c.env, c.env.DB, orgId);

  await auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'billing.connect.disconnected',
      message: `Stripe Connect account disconnected from org '${orgId}'`,
      target_type: 'org',
      target_id: orgId,
      metadata_json: { ...result },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({ data: result });
});

/**
 * @route POST /api/billing/usage
 * @description Internal record-a-usage-event endpoint. Used by middleware on
 *   the originating Worker — never call directly from a browser.
 * @auth Bearer — orgId required.
 */
billing.post('/api/billing/usage', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const body = (await c.req.json().catch(() => ({}))) as {
    metric?: string;
    value?: number;
    site_id?: string | null;
  };
  if (
    !body.metric ||
    (body.metric !== 'ai_calls' &&
      body.metric !== 'bytes_egress' &&
      body.metric !== 'image_generations')
  ) {
    throw badRequest('metric must be one of: ai_calls, bytes_egress, image_generations');
  }
  if (typeof body.value !== 'number' || body.value < 0) {
    throw badRequest('value must be a non-negative number');
  }
  await usageMetering.recordUsage(c.env, c.env.DB, {
    orgId,
    metric: body.metric,
    value: body.value,
    siteId: body.site_id ?? null,
  });
  return c.json({ data: { ok: true } });
});

/**
 * @route GET /api/billing/usage/this-month
 * @auth Bearer — orgId required.
 */
billing.get('/api/billing/usage/this-month', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const payload = await usageMetering.getUsagePanelPayload(c.env.DB, orgId);
  return c.json({ data: payload });
});

/**
 * Create a new spend alert rule for the caller's org.
 *
 * @route POST /api/billing/spend-alerts
 * @auth Bearer orgId required.
 * @body `{ name, trigger, threshold_credits, email, channels?: string[],
 *   site_id?: string }` — validated via `createSpendAlertSchema`. `trigger`
 *   is one of `balance_below | monthly_spend_above | rate_spike`. `channels`
 *   defaults to `['email']` and accepts `email | slack | discord | pagerduty`.
 *   `site_id` is optional — when supplied, the cron sweep scopes the alert
 *   to a single site's usage; when omitted the alert evaluates the whole org.
 * @returns 201 `{ data: SpendAlert }`.
 * @throws UNAUTHORIZED, VALIDATION_ERROR.
 *
 * @remarks
 * No ownership check on `site_id` — the field is informational for the cron
 * sweep, NOT a cross-tenant access vector. The cron join is always
 * `spend_alerts.org_id = <caller>` so a stale or wrong `site_id` cannot leak
 * usage from another org's site.
 */
billing.post('/api/billing/spend-alerts', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const { createSpendAlertSchema: cas } = await import('@project-sites/shared/schemas');
  // Malformed body → ZodError 400 (createSpendAlertSchema required fields), not 500.
  const body = await c.req.json().catch(() => ({}));
  const parsed = cas.parse(body);

  const id = crypto.randomUUID();
  const channelsJson = JSON.stringify(parsed.channels);
  await dbInsert(c.env.DB, 'spend_alerts', {
    id,
    org_id: orgId,
    site_id: parsed.site_id ?? null,
    name: parsed.name,
    trigger_type: parsed.trigger,
    threshold_credits: parsed.threshold_credits,
    email: parsed.email,
    channels_json: channelsJson,
    last_fired_at: null,
    fire_count: 0,
    created_by: c.get('userId') ?? null,
    deleted_at: null,
  });

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'billing.spend_alert_created',
      message: `Spend alert '${parsed.name}' created (${parsed.trigger} @ ${parsed.threshold_credits} credits → ${parsed.email})`,
      target_type: 'spend_alert',
      target_id: id,
      metadata_json: {
        trigger: parsed.trigger,
        threshold_credits: parsed.threshold_credits,
        email: parsed.email,
        channels: parsed.channels,
        site_id: parsed.site_id ?? null,
      },
      request_id: c.get('requestId'),
    }),
  );

  return c.json(
    {
      data: {
        id,
        org_id: orgId,
        site_id: parsed.site_id ?? null,
        name: parsed.name,
        trigger_type: parsed.trigger,
        threshold_credits: parsed.threshold_credits,
        email: parsed.email,
        channels_json: channelsJson,
        last_fired_at: null,
        fire_count: 0,
      },
    },
    201,
  );
});

/**
 * List spend alerts for the caller's org.
 *
 * @route GET /api/billing/spend-alerts
 * @auth Bearer orgId required.
 * @returns `{ data: SpendAlert[] }` — soft-deleted rows excluded, newest first.
 */
billing.get('/api/billing/spend-alerts', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const rows = await dbQuery<{
    id: string;
    org_id: string;
    site_id: string | null;
    name: string;
    trigger_type: string;
    threshold_credits: number;
    email: string;
    channels_json: string;
    last_fired_at: string | null;
    fire_count: number;
    created_at: string;
    updated_at: string;
  }>(
    c.env.DB,
    `SELECT id, org_id, site_id, name, trigger_type, threshold_credits, email,
            channels_json, last_fired_at, fire_count, created_at, updated_at
       FROM spend_alerts
      WHERE org_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [orgId],
  );

  return c.json({ data: rows.data });
});

/**
 * Soft-delete a spend alert.
 *
 * @route DELETE /api/billing/spend-alerts/:id
 * @auth Bearer orgId required — cross-org guard via `WHERE org_id = ?`.
 * @returns `{ data: { deleted: true } }` (idempotent — 200 on already-deleted).
 */
billing.delete('/api/billing/spend-alerts/:id', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const alertId = c.req.param('id');
  const existing = await dbQueryOne<{ name: string }>(
    c.env.DB,
    'SELECT name FROM spend_alerts WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [alertId, orgId],
  );
  if (!existing) throw notFound('Spend alert not found');

  await c.env.DB.prepare(
    "UPDATE spend_alerts SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND org_id = ?",
  )
    .bind(alertId, orgId)
    .run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'billing.spend_alert_deleted',
      message: `Spend alert '${existing.name}' deleted`,
      target_type: 'spend_alert',
      target_id: alertId,
      metadata_json: { name: existing.name },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({ data: { deleted: true } });
});

/**
 * Create a Stripe Checkout Session (redirect flow) for plan upgrade.
 *
 * @route POST /api/billing/checkout
 * @auth Bearer — `userId` AND `orgId` MUST resolve from session
 * @body createCheckoutSessionSchema — `{ site_id?, success_url, cancel_url, budget_tier, org_id? }`
 * @returns 200 OK `{ data: { session_id, url } }` — caller redirects browser to `url`
 * @throws {AppError} `UNAUTHORIZED` — session missing userId or orgId.
 * @throws {AppError} `FORBIDDEN` — `validated.org_id` provided but does not match session orgId
 *   (cross-org checkout block — never trust caller-supplied org).
 * @throws {ZodError} — body fails `createCheckoutSessionSchema` (auto-caught by Hono error
 *   handler, rendered as `VALIDATION_ERROR`).
 *
 * @remarks
 * Customer email lookup: hits `users` table with `deleted_at IS NULL` filter; soft-deleted
 * users collapse to `email: ''` — Stripe handles gracefully but billing emails will fail
 * delivery. Audit log + PostHog `checkout_created` event fire fire-and-forget AFTER the
 * Stripe call succeeds (failures swallowed via `.catch(() => {})` to keep latency on
 * critical path).
 *
 * Use this endpoint for the classic Stripe Checkout redirect flow. For the embedded
 * (in-page Stripe.js) flow, use `/api/billing/embedded-checkout` instead.
 *
 * @example
 * ```bash
 * curl -X POST https://projectsites.dev/api/billing/checkout \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{"site_id":"abc","budget_tier":"patron","success_url":"https://...","cancel_url":"https://..."}'
 * ```
 *
 * @see {@link billingService.createCheckoutSession}
 */
billing.post('/api/billing/checkout', async (c) => {
  // Malformed body → ZodError 400 (missing success_url/cancel_url), not 500.
  const body = await c.req.json().catch(() => ({}));
  const validated = createCheckoutSessionSchema.parse(body);

  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) throw unauthorized('Must be authenticated');
  if (validated.org_id && validated.org_id !== orgId) {
    throw forbidden('Cannot create checkout for another org');
  }

  const userRow = await dbQueryOne<{ email: string }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  );

  const result = await billingService.createCheckoutSession(c.env.DB, c.env, {
    orgId,
    siteId: validated.site_id,
    customerEmail: userRow?.email || '',
    successUrl: validated.success_url,
    cancelUrl: validated.cancel_url,
    budgetTier: validated.budget_tier,
  });

  auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'billing.checkout_created',
      message: `Stripe checkout session created for '${validated.budget_tier}' tier`,
      target_type: 'billing',
      target_id: validated.site_id || orgId,
      metadata_json: {
        site_id: validated.site_id,
        session_id: result.session_id || null,
        budget_tier: validated.budget_tier,
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  try {
    posthog.trackSite(c.env, c.executionCtx, 'checkout_created', c.get('userId') || orgId, {
      site_id: validated.site_id,
    });
  } catch {
    /* fire-and-forget */
  }

  return c.json({ data: result });
});

/**
 * Create a Stripe embedded Checkout Session (in-page Stripe.js mount) for plan upgrade.
 *
 * @route POST /api/billing/embedded-checkout
 * @auth Bearer — `userId` AND `orgId` MUST resolve from session
 * @body createEmbeddedCheckoutSchema — `{ site_id?, return_url, budget_tier, org_id? }`
 * @returns 200 OK `{ data: { client_secret, publishable_key } }` — caller mounts Stripe.js
 *   `EmbeddedCheckout` element with these credentials. `publishable_key` injected from
 *   `c.env.STRIPE_PUBLISHABLE_KEY` so frontend doesn't need its own copy.
 * @throws {AppError} `UNAUTHORIZED` — session missing userId or orgId.
 * @throws {AppError} `FORBIDDEN` — `validated.org_id` mismatches session orgId.
 * @throws {ZodError} — body fails `createEmbeddedCheckoutSchema`.
 *
 * @remarks
 * Mirrors `/api/billing/checkout` but returns a `client_secret` for in-page Stripe.js
 * mount instead of a redirect URL. Use this endpoint when keeping the user inside the
 * Angular SPA (better UX, no page bounce). The `return_url` is where Stripe redirects
 * AFTER successful payment confirmation.
 *
 * Audit log fires `billing.embedded_checkout_created` (distinct from `.checkout_created`
 * so analytics can A/B the two flows). PostHog event `embedded_checkout_created`.
 *
 * @see {@link billingService.createEmbeddedCheckoutSession}
 * @see {@link https://stripe.com/docs/checkout/embedded/quickstart Stripe Embedded Checkout}
 */
billing.post('/api/billing/embedded-checkout', async (c) => {
  // Malformed body → ZodError 400 (missing return_url), not 500.
  const body = await c.req.json().catch(() => ({}));
  const validated = createEmbeddedCheckoutSchema.parse(body);

  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) throw unauthorized('Must be authenticated');
  if (validated.org_id && validated.org_id !== orgId) {
    throw forbidden('Cannot create checkout for another org');
  }

  const userRow = await dbQueryOne<{ email: string }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  );

  const result = await billingService.createEmbeddedCheckoutSession(c.env.DB, c.env, {
    orgId,
    siteId: validated.site_id,
    customerEmail: userRow?.email || '',
    returnUrl: validated.return_url,
    budgetTier: validated.budget_tier,
  });

  auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'billing.embedded_checkout_created',
      message: `Stripe embedded checkout session created for '${validated.budget_tier}' tier`,
      target_type: 'billing',
      target_id: validated.site_id || orgId,
      metadata_json: {
        site_id: validated.site_id,
        session_id: result.session_id || null,
        budget_tier: validated.budget_tier,
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  try {
    posthog.trackSite(
      c.env,
      c.executionCtx,
      'embedded_checkout_created',
      c.get('userId') || orgId,
      { site_id: validated.site_id },
    );
  } catch {
    /* fire-and-forget */
  }

  return c.json({
    data: { client_secret: result.client_secret, publishable_key: c.env.STRIPE_PUBLISHABLE_KEY },
  });
});

/**
 * Create a Stripe **PaymentIntent** for inline 1-click checkout via Express
 * Checkout Element (Apple Pay / Google Pay / Link) + Payment Element.
 *
 * @route POST /api/billing/payment-intent
 * @auth Bearer — `userId` AND `orgId` MUST resolve from session
 * @body createPaymentIntentSchema — `{ amount_cents, currency?, site_id?, description?, save_for_future_use? }`
 * @returns 200 OK `{ data: { client_secret, publishable_key, payment_intent_id } }`
 *
 * @remarks
 * Caller mounts `stripeService.mountExpressCheckout()` or
 * `stripeService.mountPaymentElement()` with the returned `client_secret`. The
 * minimal-widget row appears inline (no modal, no redirect) and Stripe picks
 * the right method per browser. Returns `payment_intent_id` so callers can
 * poll status server-side if needed.
 */
billing.post('/api/billing/payment-intent', async (c) => {
  // Malformed body → ZodError 400 (missing amount_cents), not 500.
  const body = await c.req.json().catch(() => ({}));
  const validated = createPaymentIntentSchema.parse(body);

  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) throw unauthorized('Must be authenticated');
  if (validated.org_id && validated.org_id !== orgId) {
    throw forbidden('Cannot create payment for another org');
  }

  const userRow = await dbQueryOne<{ email: string }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  );

  const result = await billingService.createPaymentIntent(c.env.DB, c.env, {
    orgId,
    siteId: validated.site_id,
    customerEmail: userRow?.email || '',
    amountCents: validated.amount_cents,
    currency: validated.currency,
    description: validated.description,
    saveForFutureUse: validated.save_for_future_use,
  });

  auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'billing.payment_intent_created',
      message: `PaymentIntent ${result.payment_intent_id} created for ${validated.amount_cents}¢`,
      target_type: 'billing',
      target_id: validated.site_id || orgId,
      metadata_json: {
        site_id: validated.site_id ?? null,
        amount_cents: validated.amount_cents,
        currency: validated.currency,
        payment_intent_id: result.payment_intent_id,
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  try {
    posthog.trackSite(c.env, c.executionCtx, 'payment_intent_created', userId, {
      site_id: validated.site_id,
      amount_cents: validated.amount_cents,
    });
  } catch {
    /* fire-and-forget */
  }

  return c.json({
    data: {
      client_secret: result.client_secret,
      publishable_key: c.env.STRIPE_PUBLISHABLE_KEY,
      payment_intent_id: result.payment_intent_id,
    },
  });
});

/**
 * Create a Stripe Customer Billing Portal session — lets the customer self-manage
 * subscription (upgrade/downgrade/cancel), payment method, and invoices.
 *
 * @route POST /api/billing/portal
 * @auth Bearer — `orgId` MUST resolve
 * @body Optional `{ return_url?: string }` — where Stripe sends customer after closing
 *   portal. Defaults to `https://${DOMAINS.SITES_BASE}` (projectsites.dev root).
 * @returns 200 OK `{ data: { url: string } }` — caller redirects browser to `url`
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 * @throws {AppError} `BAD_REQUEST` — org has no `stripe_customer_id` (never subscribed,
 *   nothing to manage). Message prompts user to subscribe first.
 *
 * @remarks
 * Looks up `stripe_customer_id` from `subscriptions` table (single source of truth per
 * org). Calls `billingService.createBillingPortalSession` which hits Stripe's
 * `/v1/billing_portal/sessions` endpoint. Session expires after ~1 hour per Stripe spec.
 *
 * Audit log fires `billing.portal_opened` fire-and-forget.
 *
 * @see {@link billingService.createBillingPortalSession}
 * @see {@link https://stripe.com/docs/billing/subscriptions/customer-portal Stripe Customer Portal}
 */
billing.post('/api/billing/portal', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const body = await c.req.json();
  const returnUrl = (body as { return_url?: string }).return_url || `https://${DOMAINS.SITES_BASE}`;

  const sub = await dbQueryOne<{ stripe_customer_id: string | null }>(
    c.env.DB,
    'SELECT stripe_customer_id FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
    [orgId],
  );

  if (!sub?.stripe_customer_id) {
    throw badRequest('No billing account found. Please subscribe first.');
  }

  const result = await billingService.createBillingPortalSession(
    c.env,
    sub.stripe_customer_id,
    returnUrl,
  );

  auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'billing.portal_opened',
      message: 'Stripe billing portal session opened for subscription management',
      target_type: 'billing',
      target_id: orgId,
      metadata_json: {
        stripe_customer_id: sub.stripe_customer_id,
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({ data: result });
});
