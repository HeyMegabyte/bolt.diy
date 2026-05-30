/**
 * @module services/comparison_pages
 * @description Comparison + Alternative Pages Engine (feature #31).
 *
 * Manages `competitors` (named rivals per site with pricing URLs) and
 * `comparison_pages` (`/vs/{competitor}` + `/alternatives/{competitor}`).
 * A weekly scheduled Worker calls {@link refreshPricing} to re-fetch
 * pricing pages via Browser Rendering REST.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from './db.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  comparisonRouteSlug,
  PricingPlanSchema,
  type ComparisonGenerateRequest,
  type Competitor,
  type PricingPlan,
} from '../../libs/features/comparison_pages/feature.schemas.js';

/** Feature-flag key gating every Comparison Pages route. */
export const FLAG_KEY = 'comparison_pages';

// ─── Tenant ownership ────────────────────────────────────────────────

/**
 * Resolve the owning org of a site, for multi-tenant isolation checks.
 *
 * @remarks Defensive read — a missing/soft-deleted site returns `undefined`
 * (caller maps that to a 404, never a throw). Handlers compare the result to
 * the authenticated `orgId` so a caller can never read or mutate another org's
 * competitors or comparison pages by guessing a `siteId`.
 * @param env    - Worker env (D1 binding).
 * @param siteId - The site whose owner is being resolved.
 * @returns The owning `org_id`, or `undefined` when the site does not exist.
 * @example
 * ```ts
 * const owner = await siteOrgId(env, siteId);
 * if (!owner || owner !== orgId) return notFound(c);
 * ```
 */
export async function siteOrgId(env: Env, siteId: string): Promise<string | undefined> {
  const row = await dbQueryOne<{ org_id: string }>(
    env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  return row?.org_id ?? undefined;
}

// ─── Competitor registry ─────────────────────────────────────────────

export async function listCompetitors(env: Env, siteId: string): Promise<Competitor[]> {
  const { data } = await dbQuery<{
    slug: string;
    name: string;
    homepage_url: string | null;
    pricing_url: string | null;
    pricing_json: string | null;
    features_json: string | null;
  }>(
    env.DB,
    `SELECT slug, name, homepage_url, pricing_url, pricing_json, features_json
     FROM competitors
     WHERE site_id = ? AND deleted_at IS NULL
     ORDER BY slug`,
    [siteId],
  );
  return data.map((row) => ({
    slug: row.slug,
    name: row.name,
    homepageUrl: row.homepage_url ?? undefined,
    pricingUrl: row.pricing_url ?? undefined,
    pricingPlans: row.pricing_json ? safeParseArray(row.pricing_json) : undefined,
    featuresJson: row.features_json ? safeParseObject(row.features_json) : undefined,
  }));
}

function safeParseArray(json: string): PricingPlan[] | undefined {
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return undefined;
    const out: PricingPlan[] = [];
    for (const item of v) {
      const parsed = PricingPlanSchema.safeParse(item);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  } catch {
    return undefined;
  }
}
function safeParseObject(json: string): Record<string, boolean> | undefined {
  try {
    const v = JSON.parse(json);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, boolean>;
    return undefined;
  } catch {
    return undefined;
  }
}

export async function seedCompetitors(
  env: Env,
  siteId: string,
  orgId: string,
  competitors: Competitor[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const c of competitors) {
    const existing = await dbQueryOne<{ id: string }>(
      env.DB,
      'SELECT id FROM competitors WHERE site_id = ? AND slug = ? AND deleted_at IS NULL',
      [siteId, c.slug],
    );
    if (existing) {
      await dbExecute(
        env.DB,
        `UPDATE competitors
         SET name = ?, homepage_url = ?, pricing_url = ?,
             pricing_json = ?, features_json = ?, updated_at = ?
         WHERE id = ?`,
        [
          c.name,
          c.homepageUrl ?? null,
          c.pricingUrl ?? null,
          c.pricingPlans ? JSON.stringify(c.pricingPlans) : null,
          c.featuresJson ? JSON.stringify(c.featuresJson) : null,
          new Date().toISOString(),
          existing.id,
        ],
      );
      updated++;
    } else {
      await dbInsert(env.DB, 'competitors', {
        id: crypto.randomUUID(),
        site_id: siteId,
        org_id: orgId,
        slug: c.slug,
        name: c.name,
        homepage_url: c.homepageUrl ?? null,
        pricing_url: c.pricingUrl ?? null,
        pricing_json: c.pricingPlans ? JSON.stringify(c.pricingPlans) : null,
        features_json: c.featuresJson ? JSON.stringify(c.featuresJson) : null,
      });
      inserted++;
    }
  }
  return { inserted, updated };
}

// ─── Page generation ─────────────────────────────────────────────────

export async function generatePages(
  env: Env,
  siteId: string,
  orgId: string,
  req: ComparisonGenerateRequest,
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const slug of req.competitorSlugs) {
    const exists = await dbQueryOne<{ id: string }>(
      env.DB,
      'SELECT id FROM competitors WHERE site_id = ? AND slug = ? AND deleted_at IS NULL',
      [siteId, slug],
    );
    if (!exists) {
      skipped++;
      continue;
    }
    for (const kind of req.kinds) {
      const dupe = await dbQueryOne<{ id: string }>(
        env.DB,
        `SELECT id FROM comparison_pages
         WHERE site_id = ? AND competitor_slug = ? AND kind = ? AND deleted_at IS NULL`,
        [siteId, slug, kind],
      );
      if (dupe) {
        skipped++;
        continue;
      }
      await dbInsert(env.DB, 'comparison_pages', {
        id: crypto.randomUUID(),
        site_id: siteId,
        org_id: orgId,
        competitor_slug: slug,
        kind,
        route_slug: comparisonRouteSlug(slug, kind),
        status: 'draft',
      });
      inserted++;
    }
  }
  return { inserted, skipped };
}

// ─── Weekly pricing refresh ──────────────────────────────────────────

/**
 * Scrape competitor pricing pages via Browser Rendering REST.
 * Best-effort: every failure logged + skipped. Designed for a CRON trigger.
 */
export async function refreshPricing(
  env: Env,
  siteId: string,
  competitorSlugs?: string[],
): Promise<{ refreshed: number; failed: number }> {
  if (!(await isFlagOn(env, FLAG_KEY))) {
    return { refreshed: 0, failed: 0 };
  }
  const slugFilter =
    competitorSlugs && competitorSlugs.length > 0
      ? `AND slug IN (${competitorSlugs.map(() => '?').join(',')})`
      : '';
  const params =
    competitorSlugs && competitorSlugs.length > 0 ? [siteId, ...competitorSlugs] : [siteId];
  const { data } = await dbQuery<{ id: string; slug: string; pricing_url: string | null }>(
    env.DB,
    `SELECT id, slug, pricing_url FROM competitors
     WHERE site_id = ? ${slugFilter} AND deleted_at IS NULL`,
    params,
  );

  let refreshed = 0;
  let failed = 0;
  for (const c of data) {
    if (!c.pricing_url) {
      failed++;
      continue;
    }
    const ok = await tryFetchPricing(env, c.pricing_url);
    if (ok) {
      await dbExecute(
        env.DB,
        `UPDATE competitors
         SET pricing_scraped_at = ?, updated_at = ?
         WHERE id = ?`,
        [new Date().toISOString(), new Date().toISOString(), c.id],
      );
      refreshed++;
    } else {
      failed++;
    }
  }
  return { refreshed, failed };
}

async function tryFetchPricing(env: Env, url: string): Promise<boolean> {
  try {
    const accountId = env.CF_ACCOUNT_ID;
    const apiToken = env.CF_API_TOKEN;
    if (!accountId || !apiToken) {
      // No Browser Rendering credentials — fall back to plain fetch
      const res = await fetch(url, { method: 'HEAD' });
      return res.ok;
    }
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/content`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ url }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listPages(env: Env, siteId: string, status?: string) {
  const where = status
    ? 'WHERE site_id = ? AND status = ? AND deleted_at IS NULL'
    : 'WHERE site_id = ? AND deleted_at IS NULL';
  const params = status ? [siteId, status] : [siteId];
  const { data } = await dbQuery<{
    id: string;
    route_slug: string;
    competitor_slug: string;
    kind: string;
    status: string;
    published_at: string | null;
  }>(
    env.DB,
    `SELECT id, route_slug, competitor_slug, kind, status, published_at
     FROM comparison_pages ${where}
     ORDER BY created_at DESC LIMIT 200`,
    params,
  );
  return data;
}
