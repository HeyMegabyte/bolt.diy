/**
 * Multi-URL Cloudflare GraphQL Analytics aggregation.
 *
 * Each site has 1 primary URL + N alternates (custom domain, vanity host,
 * staging slot). This service:
 *
 * 1. Reads every {@link SiteUrl} bound to the site.
 * 2. Resolves each hostname's CF zone (KV-cached for 7 days).
 * 3. Issues one GraphQL query per URL in parallel.
 * 4. Aggregates: page-views + uniques per day bucket, top pages (dedupe by
 *    path), top countries (sum by country), top referrers (sum by host).
 * 5. Caches the result in KV (5 min TTL keyed by `site_id` + range).
 *
 * Uses `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` global-key auth — the same
 * pattern Wrangler uses for `wrangler deploy` against this account.
 * Per-org credentials override the worker-bundled defaults when present
 * via {@link ./cf_credentials.ts}.
 *
 * @see {@link cloudflare_analytics.ts} for the single-host counterpart.
 */
import type { Env } from '../types/env.js';

import { type CfAuth, cfAuthHeaders, resolveCfCredentials } from './cf_credentials.js';
import { dbQuery } from './db.js';

/** A URL bound to a site (one primary + N alternates). */
export interface SiteUrl {
  readonly id: string;
  readonly site_id: string;
  readonly hostname: string;
  readonly is_primary: number;
  readonly zone_id: string | null;
  readonly account_id: string | null;
  readonly added_at: string;
}

/** Range bucket emitted by the aggregator. */
export interface SeriesPoint {
  readonly date: string;
  readonly page_views: number;
  readonly unique_visitors: number;
  readonly requests: number;
}

/** Multi-URL aggregated analytics envelope. */
export interface MultiUrlAnalytics {
  readonly range_days: number;
  readonly urls_included: ReadonlyArray<{ hostname: string; resolved_zone: boolean }>;
  readonly pageviews: number;
  readonly uniques: number;
  readonly total_requests: number;
  readonly series: ReadonlyArray<SeriesPoint>;
  readonly top_pages: ReadonlyArray<{ path: string; views: number }>;
  readonly top_countries: ReadonlyArray<{ country: string; views: number }>;
  readonly top_referrers: ReadonlyArray<{ referrer: string; views: number }>;
  /**
   * `true` when at least one URL contributed real CF data. `false` means
   * every zone resolution failed and the envelope is all zeros — the UI
   * should surface a "connect Cloudflare credentials" CTA in that case.
   */
  readonly any_real_data: boolean;
}

const RANGE_TO_DAYS = { '7d': 7, '24h': 1, '30d': 30, '90d': 90 } as const;
export type AnalyticsRange = keyof typeof RANGE_TO_DAYS;

/** Coerce a query-string `range` value to a known range key (defaults to `7d`). */
export function parseRange(input: string | null | undefined): AnalyticsRange {
  if (input === '24h' || input === '1d') return '24h';
  if (input === '30d') return '30d';
  if (input === '90d') return '90d';
  return '7d';
}

/**
 * Apex-domain extractor for zone resolution.
 *
 * Cloudflare zones live at the apex (`example.com`), not the subdomain
 * (`shop.example.com`). For `projectsites.dev` subdomains, return the apex
 * directly; for everything else, take the last two labels (good enough for
 * standard TLDs — multi-label TLDs like `.co.uk` get the wrong zone but
 * those are out of scope until we hit one in production).
 */
export function apexDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
  if (host.endsWith('.projectsites.dev') || host === 'projectsites.dev') {
    return 'projectsites.dev';
  }
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  return parts.slice(-2).join('.');
}

interface CfZoneRow {
  readonly id: string;
  readonly name: string;
  readonly account?: { readonly id?: string };
}

/**
 * Resolve a hostname to its CF zone (id + account_id). KV-cached for 7 days
 * keyed by `zone:{apex}`.
 *
 * Returns `null` when:
 * - The zone is not in any account this credential can access.
 * - The CF API call fails (logged at warn-level, not thrown).
 */
export async function resolveZoneForHostname(
  env: Env,
  auth: CfAuth,
  hostname: string,
): Promise<{ zone_id: string; account_id: string } | null> {
  const apex = apexDomain(hostname);
  const cacheKey = `zone:${apex}`;
  try {
    const cached = await env.CACHE_KV.get(cacheKey, 'json');
    if (cached && typeof cached === 'object' && 'zone_id' in cached) {
      return cached as { zone_id: string; account_id: string };
    }
  } catch { /* cache miss is fine */ }

  // Hardcoded fast path — every projectsites.dev subdomain shares one zone.
  if (apex === 'projectsites.dev' && env.CF_ZONE_ID) {
    const zone = { account_id: env.CF_ACCOUNT_ID ?? '', zone_id: env.CF_ZONE_ID };
    try { await env.CACHE_KV.put(cacheKey, JSON.stringify(zone), { expirationTtl: 7 * 86_400 }); } catch { /* */ }
    return zone;
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(apex)}&per_page=1`,
      { headers: cfAuthHeaders(auth) },
    );
    if (!res.ok) {
      console.warn(JSON.stringify({
        apex,
        hostname,
        level: 'warn',
        op: 'resolveZoneForHostname',
        service: 'multi_url_analytics',
        status: res.status,
      }));
      return null;
    }
    const body = (await res.json()) as { result?: CfZoneRow[]; success?: boolean };
    const z = body.result?.[0];
    if (!z?.id) return null;
    const zone = { account_id: z.account?.id ?? '', zone_id: z.id };
    try { await env.CACHE_KV.put(cacheKey, JSON.stringify(zone), { expirationTtl: 7 * 86_400 }); } catch { /* */ }
    return zone;
  } catch (err) {
    console.warn(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      hostname,
      level: 'warn',
      op: 'resolveZoneForHostname',
      service: 'multi_url_analytics',
    }));
    return null;
  }
}

/** GraphQL response we depend on. */
interface CfGraphQlResponse {
  data?: {
    viewer?: {
      zones?: Array<{
        totals?: Array<{ sum?: SumFields; uniq?: UniqFields }>;
        byDay?: Array<{ dimensions?: { date?: string }; sum?: SumFields; uniq?: UniqFields }>;
        topPaths?: Array<{ dimensions?: { clientRequestPath?: string }; sum?: SumFields }>;
        byCountry?: Array<{ dimensions?: { clientCountryName?: string }; sum?: SumFields }>;
        byReferer?: Array<{ dimensions?: { clientRequestReferer?: string }; sum?: SumFields }>;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}
interface SumFields { requests?: number; pageViews?: number; edgeResponseBytes?: number; }
interface UniqFields { uniques?: number; }

/** Per-host CF GraphQL aggregate. */
interface HostAggregate {
  hostname: string;
  resolved: boolean;
  total_requests: number;
  page_views: number;
  unique_visitors: number;
  by_day: Map<string, { page_views: number; unique_visitors: number; requests: number }>;
  top_paths: Map<string, number>;
  top_countries: Map<string, number>;
  top_referrers: Map<string, number>;
}

/**
 * Query CF GraphQL for ONE host over `days` window. Returns zeros when the
 * call fails — fail-soft so one bad zone doesn't nuke the aggregate.
 */
async function loadHostAggregate(
  env: Env,
  auth: CfAuth,
  hostname: string,
  days: number,
): Promise<HostAggregate> {
  const empty: HostAggregate = {
    by_day: new Map(),
    hostname,
    page_views: 0,
    resolved: false,
    top_countries: new Map(),
    top_paths: new Map(),
    top_referrers: new Map(),
    total_requests: 0,
    unique_visitors: 0,
  };

  const zone = await resolveZoneForHostname(env, auth, hostname);
  if (!zone) return empty;

  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const until = new Date().toISOString();

  const query = /* GraphQL */ `
    query MultiUrlTraffic($zoneTag: String!, $since: Time!, $until: Time!, $host: string!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          totals: httpRequestsAdaptiveGroups(
            limit: 1
            filter: { datetime_geq: $since, datetime_leq: $until, clientRequestHTTPHost: $host }
          ) {
            sum { requests pageViews edgeResponseBytes }
            uniq { uniques }
          }
          byDay: httpRequestsAdaptiveGroups(
            limit: 100
            filter: { datetime_geq: $since, datetime_leq: $until, clientRequestHTTPHost: $host }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum { requests pageViews }
            uniq { uniques }
          }
          topPaths: httpRequestsAdaptiveGroups(
            limit: 50
            filter: { datetime_geq: $since, datetime_leq: $until, clientRequestHTTPHost: $host }
            orderBy: [sum_requests_DESC]
          ) {
            dimensions { clientRequestPath }
            sum { requests pageViews }
          }
          byCountry: httpRequestsAdaptiveGroups(
            limit: 25
            filter: { datetime_geq: $since, datetime_leq: $until, clientRequestHTTPHost: $host }
            orderBy: [sum_requests_DESC]
          ) {
            dimensions { clientCountryName }
            sum { requests }
          }
          byReferer: httpRequestsAdaptiveGroups(
            limit: 25
            filter: { datetime_geq: $since, datetime_leq: $until, clientRequestHTTPHost: $host }
            orderBy: [sum_requests_DESC]
          ) {
            dimensions { clientRequestReferer }
            sum { requests }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      body: JSON.stringify({
        query,
        variables: { host: hostname, since, until, zoneTag: zone.zone_id },
      }),
      headers: { ...cfAuthHeaders(auth), 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(JSON.stringify({
        body: body.slice(0, 300),
        hostname,
        level: 'warn',
        op: 'loadHostAggregate',
        service: 'multi_url_analytics',
        status: res.status,
      }));
      return empty;
    }
    const json = (await res.json()) as CfGraphQlResponse;
    if (json.errors?.length) {
      console.warn(JSON.stringify({
        graphql_errors: json.errors.map((e) => e.message).join('; ').slice(0, 300),
        hostname,
        level: 'warn',
        op: 'loadHostAggregate',
        service: 'multi_url_analytics',
      }));
      return empty;
    }
    const zoneRow = json.data?.viewer?.zones?.[0];
    if (!zoneRow) return { ...empty, resolved: true };

    const totals = zoneRow.totals?.[0];
    const agg: HostAggregate = {
      by_day: new Map(),
      hostname,
      page_views: Number(totals?.sum?.pageViews ?? 0),
      resolved: true,
      top_countries: new Map(),
      top_paths: new Map(),
      top_referrers: new Map(),
      total_requests: Number(totals?.sum?.requests ?? 0),
      unique_visitors: Number(totals?.uniq?.uniques ?? 0),
    };

    for (const row of zoneRow.byDay ?? []) {
      const date = String(row.dimensions?.date ?? '');
      if (!date) continue;
      agg.by_day.set(date, {
        page_views: Number(row.sum?.pageViews ?? 0),
        requests: Number(row.sum?.requests ?? 0),
        unique_visitors: Number(row.uniq?.uniques ?? 0),
      });
    }
    for (const row of zoneRow.topPaths ?? []) {
      const path = String(row.dimensions?.clientRequestPath ?? '/');
      const views = Number(row.sum?.pageViews ?? row.sum?.requests ?? 0);
      if (views > 0) agg.top_paths.set(path, (agg.top_paths.get(path) ?? 0) + views);
    }
    for (const row of zoneRow.byCountry ?? []) {
      const country = String(row.dimensions?.clientCountryName ?? 'Unknown');
      const views = Number(row.sum?.requests ?? 0);
      if (views > 0) agg.top_countries.set(country, (agg.top_countries.get(country) ?? 0) + views);
    }
    for (const row of zoneRow.byReferer ?? []) {
      const raw = String(row.dimensions?.clientRequestReferer ?? '');
      const referrer = safeHost(raw) || '(direct)';
      const views = Number(row.sum?.requests ?? 0);
      if (views > 0) agg.top_referrers.set(referrer, (agg.top_referrers.get(referrer) ?? 0) + views);
    }
    return agg;
  } catch (err) {
    console.warn(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      hostname,
      level: 'warn',
      op: 'loadHostAggregate',
      service: 'multi_url_analytics',
    }));
    return empty;
  }
}

function safeHost(referrer: string): string {
  if (!referrer || referrer === '-') return '';
  try { return new URL(referrer).hostname; } catch { return ''; }
}

/** List the URLs bound to a site (primary first, alternates after). */
export async function listSiteUrls(env: Env, siteId: string): Promise<SiteUrl[]> {
  const { data } = await dbQuery<SiteUrl>(
    env.DB,
    `SELECT id, site_id, hostname, is_primary, zone_id, account_id, added_at
     FROM site_urls
     WHERE site_id = ? AND deleted_at IS NULL
     ORDER BY is_primary DESC, added_at ASC`,
    [siteId],
  );
  return data;
}

/**
 * Aggregate CF GraphQL Analytics across every URL bound to the site.
 *
 * Caches the envelope in KV for 5 minutes keyed by
 * `analytics:{site_id}:{range}:{url_set_hash}`. The URL-set hash flips
 * whenever an alternate is added/removed so a stale aggregate never
 * survives a binding change.
 *
 * Returns zeros (with `any_real_data: false`) when no CF credentials are
 * configured, when every zone resolution fails, or when GraphQL errors
 * everywhere — fail-soft so the dashboard always renders SOMETHING.
 *
 * @param siteId - Site UUID (from `sites.id`).
 * @param orgId - Org UUID — used to look up per-org CF credentials.
 * @param range - One of `24h | 7d | 30d | 90d`.
 * @param excludeHostnames - Optional set of hostnames to skip (powers the
 *   per-URL pill "X" toggle in the UI). Removed hostnames don't change
 *   the cache key — the aggregator just zeros them out from the response.
 */
export async function loadMultiUrlAnalytics(
  env: Env,
  siteId: string,
  orgId: string | null,
  range: AnalyticsRange,
  excludeHostnames: Set<string> = new Set(),
): Promise<MultiUrlAnalytics> {
  const days = RANGE_TO_DAYS[range];
  const urls = await listSiteUrls(env, siteId);
  const filteredUrls = urls.filter((u) => !excludeHostnames.has(u.hostname));

  // URL-set hash so cache invalidates on add/remove. Excluded hostnames
  // intentionally NOT folded in — the exclude pill is a UI affordance,
  // not a cache-key dimension.
  const urlSetHash = urls.map((u) => u.hostname).sort().join('|');
  const cacheKey = `analytics:${siteId}:${range}:${hashStr(urlSetHash)}:${hashStr(Array.from(excludeHostnames).sort().join(','))}`;

  try {
    const cached = await env.CACHE_KV.get(cacheKey, 'json');
    if (cached && typeof cached === 'object' && 'pageviews' in cached) {
      return cached as MultiUrlAnalytics;
    }
  } catch { /* cache miss fine */ }

  const auth = await resolveCfCredentials(env, orgId);

  // No credentials at all → empty envelope, flagged so the UI shows the CTA.
  if (!auth) {
    const empty: MultiUrlAnalytics = {
      any_real_data: false,
      pageviews: 0,
      range_days: days,
      series: emptySeries(days),
      top_countries: [],
      top_pages: [],
      top_referrers: [],
      total_requests: 0,
      uniques: 0,
      urls_included: filteredUrls.map((u) => ({ hostname: u.hostname, resolved_zone: false })),
    };
    return empty;
  }

  // Parallel fan-out — one query per URL. Promise.all so the slowest host
  // gates the response (acceptable: typical query is 400-800ms; running
  // 3 URLs sequentially would push past 2s easily).
  const aggregates = await Promise.all(
    filteredUrls.map((u) => loadHostAggregate(env, auth, u.hostname, days)),
  );

  // Merge by-day buckets across all hosts.
  const mergedByDay = new Map<string, { page_views: number; unique_visitors: number; requests: number }>();
  for (const agg of aggregates) {
    for (const [date, bucket] of agg.by_day) {
      const existing = mergedByDay.get(date) ?? { page_views: 0, requests: 0, unique_visitors: 0 };
      mergedByDay.set(date, {
        page_views: existing.page_views + bucket.page_views,
        requests: existing.requests + bucket.requests,
        unique_visitors: existing.unique_visitors + bucket.unique_visitors,
      });
    }
  }
  const series = [...mergedByDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, b]) => ({ date, page_views: b.page_views, requests: b.requests, unique_visitors: b.unique_visitors }));

  // Top pages / countries / referrers: sum across hosts, then top-15.
  const topPages = sumMaps(aggregates.map((a) => a.top_paths)).slice(0, 15)
    .map(([path, views]) => ({ path, views }));
  const topCountries = sumMaps(aggregates.map((a) => a.top_countries)).slice(0, 15)
    .map(([country, views]) => ({ country, views }));
  const topReferrers = sumMaps(aggregates.map((a) => a.top_referrers)).slice(0, 15)
    .map(([referrer, views]) => ({ referrer, views }));

  const envelope: MultiUrlAnalytics = {
    any_real_data: aggregates.some((a) => a.resolved && a.total_requests > 0),
    pageviews: aggregates.reduce((sum, a) => sum + a.page_views, 0),
    range_days: days,
    series,
    top_countries: topCountries,
    top_pages: topPages,
    top_referrers: topReferrers,
    total_requests: aggregates.reduce((sum, a) => sum + a.total_requests, 0),
    uniques: aggregates.reduce((sum, a) => sum + a.unique_visitors, 0),
    urls_included: filteredUrls.map((u, i) => ({
      hostname: u.hostname,
      resolved_zone: aggregates[i]?.resolved ?? false,
    })),
  };

  try {
    await env.CACHE_KV.put(cacheKey, JSON.stringify(envelope), { expirationTtl: 300 });
  } catch { /* */ }
  return envelope;
}

/** Build an empty series with one entry per day in the window. */
function emptySeries(days: number): SeriesPoint[] {
  const today = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    return {
      date: d.toISOString().slice(0, 10),
      page_views: 0,
      requests: 0,
      unique_visitors: 0,
    };
  });
}

/** Sum a list of string→number maps and return as a sorted (desc) array. */
function sumMaps(maps: ReadonlyArray<ReadonlyMap<string, number>>): Array<[string, number]> {
  const merged = new Map<string, number>();
  for (const m of maps) {
    for (const [k, v] of m) {
      merged.set(k, (merged.get(k) ?? 0) + v);
    }
  }
  return [...merged.entries()].sort((a, b) => b[1] - a[1]);
}

/** Small djb2 hash to keep cache keys short (8 hex chars). */
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}
