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
  SectionConversionsSchema,
  FormAnalyticsSchema,
  VisitorFunnelSchema,
  type SiteAnalyticsSummary,
  type SectionConversions,
  type FormAnalytics,
  type VisitorFunnel,
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

/** One day of the analytics_daily rollup series. */
export interface DailyPoint {
  day: string;
  pageviews: number;
  uniqueSessions: number;
  conversions: number;
}

/**
 * AN5 follow-on — per-day traffic series straight from the `analytics_daily`
 * rollup (O(days), not a scan of raw `visitor_events`). Trailing `days` window,
 * ascending by day. Defensive: any D1 error (table missing on a fresh env)
 * degrades to an empty series rather than throwing.
 *
 * @param env    - Worker env (uses `env.DB`).
 * @param siteId - Site to read.
 * @param days   - Trailing window 1–365 (default 30).
 * @returns `{ days: DailyPoint[] }` ascending by calendar day.
 *
 * @example
 * const { days } = await getDailySeries(env, 'site_123', 30);
 */
export async function getDailySeries(
  env: Env,
  siteId: string,
  days = 30,
): Promise<{ days: DailyPoint[] }> {
  const n = Number.isInteger(days) && days > 0 && days <= 365 ? days : 30;
  const { data, error } = await dbQuery<{
    day: string;
    pageviews: number;
    unique_sessions: number;
    conversions: number;
  }>(
    env.DB,
    `SELECT day, pageviews, unique_sessions, conversions FROM analytics_daily
     WHERE site_id = ? AND day >= date('now', ?) ORDER BY day ASC`,
    [siteId, `-${n} days`],
  );
  if (error) return { days: [] };
  return {
    days: data.map((r) => ({
      day: r.day,
      pageviews: Number(r.pageviews),
      uniqueSessions: Number(r.unique_sessions),
      conversions: Number(r.conversions),
    })),
  };
}

/**
 * AN27 — section-level conversion attribution. Aggregates the AN18 click-to-call/
 * directions/email `conversion` events (each tagged with the AN26
 * `data-ps-section`) from `visitor_events`, grouped by section + kind, ranked
 * by total desc with each section's share of all attributed conversions. Powers
 * the owner moat widget "Services drives 40% of calls".
 *
 * Defensive: any D1 error (table missing on a fresh env) degrades to an empty
 * breakdown rather than throwing. A null/absent section coalesces to
 * `(unattributed)` so conversions are never silently lost.
 *
 * @param env        - Worker env (uses `env.DB`).
 * @param siteId     - Site to attribute.
 * @param windowDays - Trailing window 1–365 (default 30).
 * @returns A validated {@link SectionConversions}, sections ranked by count desc.
 *
 * @example
 * const { sections } = await getConversionsBySection(env, 'site_123', 30);
 */
export async function getConversionsBySection(
  env: Env,
  siteId: string,
  windowDays = 30,
): Promise<SectionConversions> {
  const n = Number.isInteger(windowDays) && windowDays > 0 && windowDays <= 365 ? windowDays : 30;
  const { data, error } = await dbQuery<{ section: string | null; kind: string | null; n: number }>(
    env.DB,
    `SELECT COALESCE(json_extract(metadata, '$.section'), '(unattributed)') AS section,
            json_extract(metadata, '$.kind') AS kind,
            COUNT(*) AS n
       FROM visitor_events
      WHERE site_id = ? AND event_type = 'conversion'
        AND created_at >= datetime('now', ?)
      GROUP BY section, kind`,
    [siteId, `-${n} days`],
  );

  const bySection = new Map<string, { count: number; calls: number; directions: number; emails: number }>();
  let totalConversions = 0;
  if (!error) {
    for (const r of data) {
      const section = r.section ?? '(unattributed)';
      const c = Number(r.n) || 0;
      totalConversions += c;
      const agg = bySection.get(section) ?? { count: 0, calls: 0, directions: 0, emails: 0 };
      agg.count += c;
      if (r.kind === 'call') agg.calls += c;
      else if (r.kind === 'directions') agg.directions += c;
      else if (r.kind === 'email') agg.emails += c;
      bySection.set(section, agg);
    }
  }

  const sections = [...bySection.entries()]
    .map(([section, a]) => ({
      section,
      count: a.count,
      percent: totalConversions > 0 ? Math.round((a.count / totalConversions) * 1000) / 10 : 0,
      calls: a.calls,
      directions: a.directions,
      emails: a.emails,
    }))
    .sort((x, y) => y.count - x.count);

  return SectionConversionsSchema.parse({
    siteId,
    windowDays: n,
    totalConversions,
    sections,
    generatedAt: new Date().toISOString(),
  });
}

/**
 * AN19 — per-site visitor funnel by distinct session: landing (≥1 pageview) →
 * engaged (≥2 pageviews) → converted (≥1 conversion event). Reads
 * `visitor_events` (session_id set server-side per pageview + on mirrored beacon
 * conversions), one GROUP BY pass per session. Each stage carries its share of the
 * landing (top) sessions, so the
 * owner sees the drop-off. Defensive → all-zero on D1 error.
 *
 * @param env        - Worker env (uses `env.DB`).
 * @param siteId     - Site to analyze.
 * @param windowDays - Trailing window 1–365 (default 30).
 * @returns A validated {@link VisitorFunnel}.
 *
 * @example
 * const { stages } = await getVisitorFunnel(env, 'site_1', 30);
 */
export async function getVisitorFunnel(
  env: Env,
  siteId: string,
  windowDays = 30,
): Promise<VisitorFunnel> {
  const n = Number.isInteger(windowDays) && windowDays > 0 && windowDays <= 365 ? windowDays : 30;
  const { data, error } = await dbQuery<{ pv: number; conv: number }>(
    env.DB,
    `SELECT SUM(CASE WHEN event_type = 'pageview' THEN 1 ELSE 0 END) AS pv,
            MAX(CASE WHEN event_type = 'conversion' THEN 1 ELSE 0 END) AS conv
       FROM visitor_events
      WHERE site_id = ? AND session_id IS NOT NULL
        AND created_at >= datetime('now', ?)
      GROUP BY session_id`,
    [siteId, `-${n} days`],
  );

  let landing = 0;
  let engaged = 0;
  let converted = 0;
  if (!error) {
    for (const r of data) {
      const pv = Number(r.pv) || 0;
      if (pv >= 1) landing += 1;
      if (pv >= 2) engaged += 1;
      if (Number(r.conv) > 0) converted += 1;
    }
  }
  const pct = (v: number) => (landing > 0 ? Math.round((v / landing) * 1000) / 10 : 0);

  return VisitorFunnelSchema.parse({
    siteId,
    windowDays: n,
    stages: [
      { key: 'landing', label: 'Landed', sessions: landing, percentOfLanding: landing > 0 ? 100 : 0 },
      { key: 'engaged', label: 'Engaged (2+ pages)', sessions: engaged, percentOfLanding: pct(engaged) },
      { key: 'converted', label: 'Converted', sessions: converted, percentOfLanding: pct(converted) },
    ],
    generatedAt: new Date().toISOString(),
  });
}

/** RFC-4180 escape: quote a field when it contains a comma, quote, or newline. */
function csvField(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * AN42 — flatten an owner analytics summary to a portable two-column
 * (`metric,value`) CSV for one-click export/download. Pure + deterministic;
 * non-PII (counts only). The contact-source breakdown is emitted as
 * `contacts.bySource.<source>` rows so nothing is lost.
 *
 * @param summary - A {@link SiteAnalyticsSummary}.
 * @returns A CSV string with a header row + one row per metric.
 *
 * @example
 * const csv = summaryToCsv(await getSiteAnalyticsSummary(env, org, site));
 */
export function summaryToCsv(summary: SiteAnalyticsSummary): string {
  const rows: Array<[string, string | number]> = [
    ['site_id', summary.siteId],
    ['window_days', summary.windowDays],
    ['generated_at', summary.generatedAt],
    ['contacts.total', summary.contacts.total],
    ['contacts.new_in_window', summary.contacts.newInWindow],
    ['form_submissions.total', summary.formSubmissions.total],
    ['form_submissions.new_in_window', summary.formSubmissions.newInWindow],
    ['newsletter.confirmed', summary.newsletter.confirmed],
    ['newsletter.total', summary.newsletter.total],
    ['donations.raised_cents', summary.donations.raisedCents],
    ['donations.count', summary.donations.count],
    ['traffic.pageviews', summary.traffic.pageviews],
    ['traffic.unique_sessions', summary.traffic.uniqueSessions],
    ['traffic.conversions', summary.traffic.conversions],
  ];
  for (const s of summary.contacts.bySource) {
    rows.push([`contacts.bySource.${s.source}`, s.count]);
  }
  const lines = ['metric,value', ...rows.map(([k, v]) => `${csvField(k)},${csvField(v)}`)];
  return lines.join('\r\n');
}

/**
 * AN17 — per-form completion rate + abandonment. Counts the tracker's
 * `form_start` (first focus) vs `form_submit` events from `visitor_events`
 * (mirrored from the client beacon via `/api/events`), grouped by the form key
 * (`metadata.form`), and derives completion rate +
 * abandonment per form. Bridges the pageview→lead gap: shows which forms get
 * started but not finished. Ranked by starts desc.
 *
 * Defensive: any D1 error degrades to an empty list. completionRate is capped at
 * 100 (a form can record more submits than starts if a visitor submits without
 * the focus firing — e.g. autofill); abandoned floors at 0 for the same reason.
 *
 * @param env        - Worker env (uses `env.DB`).
 * @param siteId     - Site to analyze.
 * @param windowDays - Trailing window 1–365 (default 30).
 * @returns A validated {@link FormAnalytics}.
 *
 * @example
 * const { forms } = await getFormAnalytics(env, 'site_123', 30);
 */
export async function getFormAnalytics(
  env: Env,
  siteId: string,
  windowDays = 30,
): Promise<FormAnalytics> {
  const n = Number.isInteger(windowDays) && windowDays > 0 && windowDays <= 365 ? windowDays : 30;
  const { data, error } = await dbQuery<{ form: string | null; eventType: string; n: number }>(
    env.DB,
    `SELECT COALESCE(json_extract(metadata, '$.form'), '(unnamed)') AS form,
            event_type AS eventType,
            COUNT(*) AS n
       FROM visitor_events
      WHERE site_id = ? AND event_type IN ('form_start', 'form_submit')
        AND created_at >= datetime('now', ?)
      GROUP BY form, eventType`,
    [siteId, `-${n} days`],
  );

  const byForm = new Map<string, { starts: number; submits: number }>();
  if (!error) {
    for (const r of data) {
      const form = r.form ?? '(unnamed)';
      const agg = byForm.get(form) ?? { starts: 0, submits: 0 };
      if (r.eventType === 'form_start') agg.starts += Number(r.n) || 0;
      else if (r.eventType === 'form_submit') agg.submits += Number(r.n) || 0;
      byForm.set(form, agg);
    }
  }

  const forms = [...byForm.entries()]
    .map(([form, a]) => ({
      form,
      starts: a.starts,
      submits: a.submits,
      completionRate:
        a.starts > 0 ? Math.min(100, Math.round((a.submits / a.starts) * 1000) / 10) : 0,
      abandoned: Math.max(0, a.starts - a.submits),
    }))
    .sort((x, y) => y.starts - x.starts);

  return FormAnalyticsSchema.parse({
    siteId,
    windowDays: n,
    forms,
    generatedAt: new Date().toISOString(),
  });
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
