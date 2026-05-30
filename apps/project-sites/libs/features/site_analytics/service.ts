/**
 * @module libs/features/site_analytics/service
 * @description Aggregation logic for Site Analytics. Reads existing per-site
 * tables (`contacts`, `form_submissions`, `newsletter_subscribers`,
 * `donations`/`donation_campaigns`) and rolls them into one owner summary.
 *
 * Every query is defensive: `dbQuery` swallows D1 errors into `{ error }`, so a
 * missing/renamed source table degrades that metric to 0 rather than throwing.
 * That keeps the dashboard resilient as sibling features ship or change.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery } from '../../../src/services/db.js';
import { getTrafficSummary } from '../visitor_events_core/service.js';
import {
  SiteAnalyticsSummarySchema,
  type SiteAnalyticsSummary,
  type SourceCount,
} from './schemas.js';

/** Flag key gating this feature. */
export const FLAG_KEY = 'site_analytics';

/** Run a COUNT/SUM scalar query, returning 0 on any error (missing table etc.). */
async function scalar(env: Env, sql: string, params: unknown[]): Promise<number> {
  const { data, error } = await dbQuery<{ n: number }>(env.DB, sql, params);
  if (error) return 0;
  return Number(data[0]?.n ?? 0);
}

/**
 * Resolve a site to its owning org, or null. Used by the handler to enforce
 * that the caller's org owns the site before returning analytics.
 */
export async function siteOrgId(env: Env, siteId: string): Promise<string | null> {
  const { data } = await dbQuery<{ org_id: string }>(
    env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  return data[0]?.org_id ?? null;
}

/**
 * Build the owner analytics summary for a site over a trailing window.
 *
 * @param env         - Worker env (uses `env.DB`).
 * @param orgId       - Caller's org (analytics are org-scoped).
 * @param siteId      - Site to summarize.
 * @param windowDays  - Trailing window for "new" metrics (default 30).
 * @returns A validated {@link SiteAnalyticsSummary}.
 * @example
 * ```ts
 * const summary = await getSiteAnalyticsSummary(env, orgId, siteId);
 * ```
 */
export async function getSiteAnalyticsSummary(
  env: Env,
  orgId: string,
  siteId: string,
  windowDays = 30,
): Promise<SiteAnalyticsSummary> {
  const since = `-${windowDays} days`;

  const [
    contactsTotal,
    contactsNew,
    formTotal,
    formNew,
    newsConfirmed,
    newsTotal,
    donationsRaised,
    donationsCount,
    bySourceRows,
    traffic,
  ] = await Promise.all([
    scalar(
      env,
      'SELECT COUNT(*) AS n FROM contacts WHERE org_id = ? AND site_id = ? AND deleted_at IS NULL',
      [orgId, siteId],
    ),
    scalar(
      env,
      `SELECT COUNT(*) AS n FROM contacts WHERE org_id = ? AND site_id = ? AND deleted_at IS NULL AND created_at >= datetime('now', ?)`,
      [orgId, siteId, since],
    ),
    scalar(env, 'SELECT COUNT(*) AS n FROM form_submissions WHERE org_id = ? AND site_id = ?', [
      orgId,
      siteId,
    ]),
    scalar(
      env,
      `SELECT COUNT(*) AS n FROM form_submissions WHERE org_id = ? AND site_id = ? AND created_at >= datetime('now', ?)`,
      [orgId, siteId, since],
    ),
    scalar(
      env,
      'SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE site_id = ? AND confirmed = 1 AND unsubscribed = 0',
      [siteId],
    ),
    scalar(env, 'SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE site_id = ?', [siteId]),
    scalar(
      env,
      'SELECT COALESCE(SUM(d.amount_cents), 0) AS n FROM donations d JOIN donation_campaigns c ON c.id = d.campaign_id WHERE c.site_id = ?',
      [siteId],
    ),
    scalar(
      env,
      'SELECT COUNT(*) AS n FROM donations d JOIN donation_campaigns c ON c.id = d.campaign_id WHERE c.site_id = ?',
      [siteId],
    ),
    dbQuery<{ source: string; n: number }>(
      env.DB,
      'SELECT source, COUNT(*) AS n FROM contacts WHERE org_id = ? AND site_id = ? AND deleted_at IS NULL GROUP BY source ORDER BY n DESC',
      [orgId, siteId],
    ).then((r) => (r.error ? [] : r.data)),
    // Traffic from visitor_events_core — defensive (no table/no events → all zeros).
    getTrafficSummary(env, siteId, windowDays),
  ]);

  const bySource: SourceCount[] = bySourceRows.map((r) => ({
    source: r.source,
    count: Number(r.n),
  }));

  return SiteAnalyticsSummarySchema.parse({
    siteId,
    windowDays,
    contacts: { total: contactsTotal, newInWindow: contactsNew, bySource },
    formSubmissions: { total: formTotal, newInWindow: formNew },
    newsletter: { confirmed: newsConfirmed, total: newsTotal },
    donations: { raisedCents: donationsRaised, count: donationsCount },
    traffic,
    generatedAt: new Date().toISOString(),
  });
}
