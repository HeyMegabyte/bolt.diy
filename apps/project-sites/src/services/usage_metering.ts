/**
 * @module services/usage_metering
 * @description Usage metering pipeline (item #99).
 *
 * Records three metrics into `usage_events` and (optionally) forwards
 * Pro+/Scale rows to Stripe via `POST /v1/subscription_items/{si}/usage_records`.
 *
 * | Metric              | Source                                                |
 * | ------------------- | ----------------------------------------------------- |
 * | `ai_calls`          | every `env.AI.run` invocation                         |
 * | `bytes_egress`      | sum of response body bytes from `/api/sites/{id}/serve` |
 * | `image_generations` | every successful DALL·E / Stability / Ideogram call   |
 *
 * @packageDocumentation
 */

import { dbInsert, dbQuery, dbQueryOne, dbUpdate } from './db.js';
import { USAGE_TIERS, USAGE_METRICS, OVERAGE_MICRO_USD } from '../constants/pricing.js';
import type { UsageTier, UsageMetric } from '../constants/pricing.js';
import type { Env } from '../types/env.js';

/** First and last day of the current calendar month (UTC, ISO-8601). */
export function currentMonthPeriod(now: Date = new Date()): {
  period_start: string;
  period_end: string;
} {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { period_start: start.toISOString(), period_end: end.toISOString() };
}

/**
 * Record a metered usage event.
 *
 * Never throws — write failures are logged so we don't break the originating
 * request flow.
 *
 * @example
 * ```ts
 * await recordUsage(env, env.DB, {
 *   orgId, metric: 'ai_calls', value: 1, siteId,
 * });
 * ```
 */
export async function recordUsage(
  _env: Env,
  db: D1Database,
  opts: { orgId: string; metric: UsageMetric; value: number; siteId?: string | null },
): Promise<void> {
  if (opts.value <= 0) return;
  try {
    await dbInsert(db, 'usage_events', {
      id: crypto.randomUUID(),
      org_id: opts.orgId,
      site_id: opts.siteId ?? null,
      metric: opts.metric,
      value: Math.floor(opts.value),
      ts: new Date().toISOString(),
      billed: 0,
      stripe_subscription_item_id: null,
    });
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'usage_metering',
        message: 'failed to record usage',
        org_id: opts.orgId,
        metric: opts.metric,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Sum usage for an org across the current calendar month, broken down by
 * metric. Used by `/api/billing/usage/this-month`.
 *
 * @example
 * ```ts
 * const { ai_calls, bytes_egress_mb, image_generations } =
 *   await getMonthUsage(env.DB, orgId);
 * ```
 */
export async function getMonthUsage(
  db: D1Database,
  orgId: string,
  now: Date = new Date(),
): Promise<{
  ai_calls: number;
  bytes_egress: number;
  bytes_egress_mb: number;
  image_generations: number;
  period_start: string;
  period_end: string;
}> {
  const { period_start, period_end } = currentMonthPeriod(now);
  const out: Record<UsageMetric, number> = {
    ai_calls: 0,
    bytes_egress: 0,
    image_generations: 0,
  };
  for (const metric of USAGE_METRICS) {
    const row = await dbQueryOne<{ total: number | null }>(
      db,
      `SELECT COALESCE(SUM(value), 0) AS total FROM usage_events
       WHERE org_id = ? AND metric = ? AND ts >= ? AND ts < ?`,
      [orgId, metric, period_start, period_end],
    );
    out[metric] = row?.total ?? 0;
  }
  return {
    ai_calls: out.ai_calls,
    bytes_egress: out.bytes_egress,
    bytes_egress_mb: Math.round(out.bytes_egress / (1024 * 1024)),
    image_generations: out.image_generations,
    period_start,
    period_end,
  };
}

/**
 * Resolve the active tier for an org. Free is the default; orgs on a paid
 * subscription get `pro`. `scale` is reserved for orgs with the higher
 * Stripe price id baked into their subscription metadata.
 */
export async function getOrgTier(db: D1Database, orgId: string): Promise<UsageTier> {
  const sub = await dbQueryOne<{ plan: string; status: string }>(
    db,
    'SELECT plan, status FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
    [orgId],
  );
  if (!sub || sub.plan !== 'paid' || sub.status !== 'active') return 'free';
  // Future: differentiate scale via subscription_item lookup. Default to pro.
  return 'pro';
}

/**
 * Compute overage in micro-USD for an org's current month, against the
 * tier inclusions. Returned as an integer (no float drift).
 *
 * @example
 * ```ts
 * const overage = await computeOverageMicroUsd(env.DB, orgId);
 * if (overage.total_micro_usd > 0) showUpgradeCta();
 * ```
 */
export async function computeOverageMicroUsd(
  db: D1Database,
  orgId: string,
  tier: UsageTier,
  now: Date = new Date(),
): Promise<{
  ai_calls_overage: number;
  bytes_egress_overage: number;
  image_generations_overage: number;
  total_micro_usd: number;
}> {
  const usage = await getMonthUsage(db, orgId, now);
  const inclusions = USAGE_TIERS[tier];
  const aiOver = Math.max(0, usage.ai_calls - inclusions.ai_calls);
  const egOver = Math.max(0, usage.bytes_egress - inclusions.bytes_egress);
  const imgOver = Math.max(0, usage.image_generations - inclusions.image_generations);
  // Egress is billed per GB; round UP to the nearest GB for billing parity.
  const egGbOver = Math.ceil(egOver / (1024 * 1024 * 1024));
  const totalMicroUsd =
    aiOver * OVERAGE_MICRO_USD.ai_calls +
    egGbOver * OVERAGE_MICRO_USD.bytes_egress_per_gb +
    imgOver * OVERAGE_MICRO_USD.image_generations;
  return {
    ai_calls_overage: aiOver,
    bytes_egress_overage: egOver,
    image_generations_overage: imgOver,
    total_micro_usd: totalMicroUsd,
  };
}

/**
 * Parsed shape of `env.STRIPE_USAGE_PRICE_IDS`. Returns `null` when the env
 * var is missing or malformed so callers can fall through to D1-only mode.
 */
export function parseUsagePriceIds(env: Env): Record<UsageMetric, string> | null {
  if (!env.STRIPE_USAGE_PRICE_IDS) return null;
  try {
    const parsed = JSON.parse(env.STRIPE_USAGE_PRICE_IDS) as Record<string, unknown>;
    const out: Partial<Record<UsageMetric, string>> = {};
    for (const m of USAGE_METRICS) {
      const v = parsed[m];
      if (typeof v === 'string' && v.length > 0) out[m] = v;
    }
    if (!out.ai_calls || !out.bytes_egress || !out.image_generations) return null;
    return out as Record<UsageMetric, string>;
  } catch {
    return null;
  }
}

/**
 * Dispatch unbilled usage rows to Stripe for an org on the Pro/Scale tier.
 *
 * Each metric is reported as a single aggregate quantity per call (the
 * Stripe `subscriptionItems.createUsageRecord` API accepts a quantity per
 * billing period). After a successful POST, matching rows are flipped to
 * `billed=1` in D1.
 *
 * Skips silently when:
 * - Tier is `free` (no metered subscription)
 * - `STRIPE_USAGE_PRICE_IDS` env is missing or malformed
 * - Org has no `stripe_subscription_id`
 *
 * @example
 * ```ts
 * await dispatchUsageToStripe(env, env.DB, orgId);
 * ```
 */
export async function dispatchUsageToStripe(
  env: Env,
  db: D1Database,
  orgId: string,
): Promise<{ dispatched: number; skipped_reason?: string }> {
  const tier = await getOrgTier(db, orgId);
  if (tier === 'free') return { dispatched: 0, skipped_reason: 'tier_free' };

  const priceIds = parseUsagePriceIds(env);
  if (!priceIds) return { dispatched: 0, skipped_reason: 'no_price_ids' };

  const sub = await dbQueryOne<{ stripe_subscription_id: string | null }>(
    db,
    `SELECT stripe_subscription_id FROM subscriptions
     WHERE org_id = ? AND deleted_at IS NULL`,
    [orgId],
  );
  if (!sub?.stripe_subscription_id) {
    return { dispatched: 0, skipped_reason: 'no_subscription' };
  }

  // Resolve subscription_item per metric.
  const itemsRes = await fetch(
    `https://api.stripe.com/v1/subscription_items?subscription=${encodeURIComponent(
      sub.stripe_subscription_id,
    )}&limit=20`,
    { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } },
  );
  if (!itemsRes.ok) return { dispatched: 0, skipped_reason: `items_${itemsRes.status}` };
  const itemsJson = (await itemsRes.json()) as {
    data: { id: string; price: { id: string } }[];
  };
  const itemByPrice = new Map(itemsJson.data.map((it) => [it.price.id, it.id]));

  let dispatched = 0;
  for (const metric of USAGE_METRICS) {
    const siItem = itemByPrice.get(priceIds[metric]);
    if (!siItem) continue;

    const sumRow = await dbQueryOne<{ total: number | null }>(
      db,
      `SELECT COALESCE(SUM(value), 0) AS total FROM usage_events
       WHERE org_id = ? AND metric = ? AND billed = 0`,
      [orgId, metric],
    );
    const total = sumRow?.total ?? 0;
    if (total <= 0) continue;

    const res = await fetch(
      `https://api.stripe.com/v1/subscription_items/${siItem}/usage_records`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          quantity: String(total),
          timestamp: String(Math.floor(Date.now() / 1000)),
          action: 'increment',
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'usage_metering',
          message: 'stripe usage record failed',
          metric,
          status: res.status,
          body: text,
        }),
      );
      continue;
    }
    await dbUpdate(
      db,
      'usage_events',
      { billed: 1, stripe_subscription_item_id: siItem },
      'org_id = ? AND metric = ? AND billed = 0',
      [orgId, metric],
    );
    dispatched += 1;
  }
  return { dispatched };
}

/** Lightweight wrapper that counts every Workers AI invocation. */
export async function meterAiCall(
  env: Env,
  db: D1Database,
  orgId: string,
  siteId?: string | null,
): Promise<void> {
  await recordUsage(env, db, { orgId, metric: 'ai_calls', value: 1, siteId });
}

/** Lightweight wrapper that meters image-generation success calls. */
export async function meterImageGeneration(
  env: Env,
  db: D1Database,
  orgId: string,
  siteId?: string | null,
): Promise<void> {
  await recordUsage(env, db, { orgId, metric: 'image_generations', value: 1, siteId });
}

/** Wrapper for response-body egress metering. */
export async function meterEgressBytes(
  env: Env,
  db: D1Database,
  orgId: string,
  bytes: number,
  siteId?: string | null,
): Promise<void> {
  if (bytes <= 0) return;
  await recordUsage(env, db, { orgId, metric: 'bytes_egress', value: bytes, siteId });
}

/** Re-export the static price table so route code uses one source of truth. */
export { USAGE_TIERS } from '../constants/pricing.js';

/**
 * Convenience: usage + tier + caps + overage rolled into one payload for the
 * admin /admin/billing usage panel.
 */
export async function getUsagePanelPayload(
  db: D1Database,
  orgId: string,
  now: Date = new Date(),
): Promise<{
  tier: UsageTier;
  tier_label: string;
  inclusions: { ai_calls: number; bytes_egress: number; image_generations: number };
  usage: Awaited<ReturnType<typeof getMonthUsage>>;
  overage: Awaited<ReturnType<typeof computeOverageMicroUsd>>;
  near_limit: boolean;
}> {
  const tier = await getOrgTier(db, orgId);
  const usage = await getMonthUsage(db, orgId, now);
  const overage = await computeOverageMicroUsd(db, orgId, tier, now);
  const inclusions = USAGE_TIERS[tier];
  const nearLimit =
    usage.ai_calls / inclusions.ai_calls >= 0.8 ||
    usage.bytes_egress / inclusions.bytes_egress >= 0.8 ||
    usage.image_generations / inclusions.image_generations >= 0.8;
  return {
    tier,
    tier_label: inclusions.label,
    inclusions: {
      ai_calls: inclusions.ai_calls,
      bytes_egress: inclusions.bytes_egress,
      image_generations: inclusions.image_generations,
    },
    usage,
    overage,
    near_limit: nearLimit,
  };
}

/** Aggregate usage daily for cron — used to populate billing rollups. */
export async function aggregateNightly(db: D1Database): Promise<{ rows: number }> {
  // The views (v_usage_daily_*) make read queries cheap. This function is a
  // placeholder for future materialization into a physical aggregate table.
  // For now we just touch the views to validate they exist.
  const result = await dbQuery<{ total: number | null }>(
    db,
    'SELECT COUNT(*) AS total FROM v_usage_daily_ai_calls',
    [],
  );
  return { rows: result.data[0]?.total ?? 0 };
}
