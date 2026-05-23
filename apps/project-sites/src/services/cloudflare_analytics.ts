/**
 * Cloudflare Zone Analytics (GraphQL API).
 *
 * This module queries Cloudflare's **public-traffic** analytics for sites
 * served under the `projectsites.dev` zone via the GraphQL Analytics API at
 * `https://api.cloudflare.com/client/v4/graphql`. It complements
 * {@link ../services/cf_analytics.ts} which writes/reads our **internal**
 * Workers Analytics Engine dataset (admin-visit telemetry).
 *
 * The naming convention:
 *   - `cf_analytics.ts`           → Analytics Engine writer + reader (admin)
 *   - `cloudflare_analytics.ts`   → CF GraphQL zone analytics (public traffic)
 *
 * Auth: a single `CF_API_TOKEN` (already required for Custom Hostnames). The
 * token needs the **Account → Analytics: Read** AND **Zone → Analytics:
 * Read** permissions on zone `75a6f8d5e441cd7124552976ba894f83`.
 *
 * @remarks
 * The `httpRequestsAdaptiveGroups` dataset is "the new one" — replaces the
 * legacy `httpRequests1mGroups` / `httpRequests1dGroups` and gives 1-minute
 * resolution back to ~30 days. Cloudflare keeps the legacy datasets working
 * but routes new features to the adaptive one.
 *
 * @see {@link https://developers.cloudflare.com/analytics/graphql-api/}
 *
 * @example
 * ```ts
 * const data = await loadSiteTraffic(env, 'vitos-mens-salon', 7);
 * // → { range_days, total_requests, page_views, unique_visitors, by_day, top_paths, by_country }
 * ```
 */
import type { Env } from '../types/env.js';

/** Daily traffic bucket. */
export interface DailyBucket {
  /** ISO `YYYY-MM-DD` UTC. */
  readonly day: string;
  /** Total HTTP requests served from CF edge. */
  readonly requests: number;
  /** Approximated page views — requests filtered to `text/html`. */
  readonly page_views: number;
  /** Distinct visitors by IP fingerprint (CF estimate). */
  readonly unique_visitors: number;
  /** Bytes egressed for this slug on this day. */
  readonly bytes: number;
}

/** Path histogram entry. */
export interface PathBucket {
  readonly path: string;
  readonly requests: number;
}

/** Geo histogram entry. */
export interface CountryBucket {
  readonly country: string;
  readonly requests: number;
}

/** Aggregated zone-analytics envelope for one site slug. */
export interface SiteTraffic {
  /** Look-back window in days. */
  readonly range_days: number;
  /** Total requests in window. */
  readonly total_requests: number;
  /** Total page views (text/html responses). */
  readonly page_views: number;
  /** Approximate unique visitors. */
  readonly unique_visitors: number;
  /** Daily series, oldest → newest. */
  readonly by_day: ReadonlyArray<DailyBucket>;
  /** Top 25 requested paths by request count. */
  readonly top_paths: ReadonlyArray<PathBucket>;
  /** Top 25 countries by request count. */
  readonly by_country: ReadonlyArray<CountryBucket>;
}

/**
 * Whether CF GraphQL Analytics is configured for this Worker.
 *
 * Returns `true` when both the token and zone id are present in env. The
 * caller should fall back to D1 audit-log estimates when this is `false`.
 */
export function isCloudflareAnalyticsConfigured(env: Env): boolean {
  return Boolean(env.CF_API_TOKEN && env.CF_ZONE_ID);
}

/**
 * Query the CF GraphQL Analytics API for one site's traffic over the
 * `days` window. The slug is matched against the `Host` header dimension
 * — sites live at `{slug}.projectsites.dev` so the filter is
 * `clientRequestHTTPHost = '{slug}.projectsites.dev'`.
 *
 * @param env - Worker env, must have `CF_API_TOKEN` + `CF_ZONE_ID`.
 * @param slug - Site slug (the subdomain part, e.g. `vitos-mens-salon`).
 * @param days - Look-back window, 1–30. Clamped to that range.
 *
 * @throws {Error} when the GraphQL endpoint returns 4xx/5xx OR when the
 *   response carries a `data.errors[]` payload — caller catches + falls back.
 *
 * @example
 * ```ts
 * const t = await loadSiteTraffic(env, 'vitos-mens-salon', 7);
 * console.log(t.total_requests, t.unique_visitors);
 * ```
 */
export async function loadSiteTraffic(env: Env, slug: string, days = 7): Promise<SiteTraffic> {
  if (!isCloudflareAnalyticsConfigured(env)) {
    throw new Error('CF_API_TOKEN + CF_ZONE_ID required for Cloudflare zone analytics');
  }
  const range = Math.max(1, Math.min(30, Math.floor(days)));
  const since = new Date(Date.now() - range * 86_400_000).toISOString();
  const until = new Date().toISOString();
  const host = `${slug}.projectsites.dev`;

  // The adaptive groups dataset replaced httpRequests1dGroups for new
  // queries — keep both code paths if needed, but prefer adaptive.
  const query = /* GraphQL */ `
    query SiteTraffic($zoneTag: String!, $since: Time!, $until: Time!, $host: string!) {
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
            limit: 90
            filter: { datetime_geq: $since, datetime_leq: $until, clientRequestHTTPHost: $host }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum { requests pageViews edgeResponseBytes }
            uniq { uniques }
          }
          topPaths: httpRequestsAdaptiveGroups(
            limit: 25
            filter: { datetime_geq: $since, datetime_leq: $until, clientRequestHTTPHost: $host }
            orderBy: [sum_requests_DESC]
          ) {
            dimensions { clientRequestPath }
            sum { requests }
          }
          byCountry: httpRequestsAdaptiveGroups(
            limit: 25
            filter: { datetime_geq: $since, datetime_leq: $until, clientRequestHTTPHost: $host }
            orderBy: [sum_requests_DESC]
          ) {
            dimensions { clientCountryName }
            sum { requests }
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { zoneTag: env.CF_ZONE_ID, since, until, host },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CF GraphQL ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as CfGraphQlResponse;
  if (json.errors?.length) {
    throw new Error(`CF GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  const zone = json.data?.viewer?.zones?.[0];
  if (!zone) {
    return emptyTraffic(range);
  }

  const totalsRow = zone.totals?.[0];
  const total_requests = Number(totalsRow?.sum?.requests ?? 0);
  const page_views = Number(totalsRow?.sum?.pageViews ?? 0);
  const unique_visitors = Number(totalsRow?.uniq?.uniques ?? 0);

  const by_day: DailyBucket[] = (zone.byDay ?? []).map((r) => ({
    day: String(r.dimensions?.date ?? ''),
    requests: Number(r.sum?.requests ?? 0),
    page_views: Number(r.sum?.pageViews ?? 0),
    unique_visitors: Number(r.uniq?.uniques ?? 0),
    bytes: Number(r.sum?.edgeResponseBytes ?? 0),
  }));

  const top_paths: PathBucket[] = (zone.topPaths ?? []).map((r) => ({
    path: String(r.dimensions?.clientRequestPath ?? '/'),
    requests: Number(r.sum?.requests ?? 0),
  }));

  const by_country: CountryBucket[] = (zone.byCountry ?? []).map((r) => ({
    country: String(r.dimensions?.clientCountryName ?? 'Unknown'),
    requests: Number(r.sum?.requests ?? 0),
  }));

  return { range_days: range, total_requests, page_views, unique_visitors, by_day, top_paths, by_country };
}

/** Empty envelope returned when the zone has no rows for the window. */
function emptyTraffic(range: number): SiteTraffic {
  return {
    range_days: range,
    total_requests: 0,
    page_views: 0,
    unique_visitors: 0,
    by_day: [],
    top_paths: [],
    by_country: [],
  };
}

/** Minimal shape of the CF GraphQL response we depend on. */
interface CfGraphQlResponse {
  data?: {
    viewer?: {
      zones?: Array<{
        totals?: Array<{ sum?: SumFields; uniq?: UniqFields }>;
        byDay?: Array<{ dimensions?: { date?: string }; sum?: SumFields; uniq?: UniqFields }>;
        topPaths?: Array<{ dimensions?: { clientRequestPath?: string }; sum?: SumFields }>;
        byCountry?: Array<{ dimensions?: { clientCountryName?: string }; sum?: SumFields }>;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

interface SumFields {
  requests?: number;
  pageViews?: number;
  edgeResponseBytes?: number;
}

interface UniqFields {
  uniques?: number;
}
