/**
 * Zone-level ("Network Overview") Cloudflare analytics for the whole
 * `projectsites.dev` platform.
 *
 * The per-site aggregator ({@link ./multi_url_analytics.ts}) queries the
 * PER-HOST `httpRequestsAdaptiveGroups` dataset — correct for one site, but a
 * fresh account whose sites are all zero-traffic demo subdomains renders every
 * empty state, so an operator never SEES analytics working. This service
 * queries the ZONE-level `httpRequests1dGroups` dataset for the entire
 * `projectsites.dev` zone, which exposes the real platform totals
 * (`requests` / `pageViews` / `uniques` / `countryMap`) the adaptive per-host
 * dataset lacks. The admin Analytics page renders it as an always-visible
 * "Network Overview" card above the per-site panel, so real traffic is always
 * on screen regardless of which (or whether a) site is selected.
 *
 * Uses the same `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` global-key auth as
 * the per-site aggregator (worker-bundled, account-scoped). Zone-level data is
 * platform-operator scope, so it always resolves the worker credentials
 * (never per-org) and targets the fixed projectsites.dev zone.
 *
 * @see {@link ./multi_url_analytics.ts} for the per-site, per-host counterpart.
 */
import type { Env } from '../types/env.js';

import { type CfAuth, cfAuthHeaders, resolveCfCredentials } from './cf_credentials.js';

/** The projectsites.dev zone id — the platform's single Cloudflare zone. */
const PROJECTSITES_ZONE_ID = '9ceaa211750dd31899fd5d1bf8d1ec46';

const RANGE_TO_DAYS = { '7d': 7, '24h': 1, '30d': 30, '90d': 90 } as const;
export type NetworkRange = keyof typeof RANGE_TO_DAYS;

/** Coerce a query-string `range` to a known key (defaults to `7d`). */
export function parseNetworkRange(input: string | null | undefined): NetworkRange {
  if (input === '24h' || input === '1d') return '24h';
  if (input === '30d') return '30d';
  if (input === '90d') return '90d';
  return '7d';
}

/** One day bucket in the network series. */
export interface NetworkSeriesPoint {
  readonly date: string;
  readonly requests: number;
  readonly page_views: number;
  readonly unique_visitors: number;
}

/** Zone-level network analytics envelope. */
export interface NetworkAnalytics {
  readonly zone: string;
  readonly range_days: number;
  readonly total_requests: number;
  readonly page_views: number;
  readonly unique_visitors: number;
  readonly bytes: number;
  readonly series: ReadonlyArray<NetworkSeriesPoint>;
  readonly top_countries: ReadonlyArray<{ country: string; requests: number }>;
  /**
   * `true` when the zone returned at least one request over the window.
   * `false` means no credentials, a GraphQL error, or a genuinely idle zone —
   * the UI shows a calm "no platform traffic yet" state, never a red error.
   */
  readonly any_real_data: boolean;
}

/** `httpRequests1dGroups` row shape we depend on. */
interface ZoneDayGroup {
  dimensions?: { date?: string };
  sum?: {
    requests?: number;
    pageViews?: number;
    bytes?: number;
    countryMap?: Array<{ clientCountryName?: string; requests?: number }>;
  };
  uniq?: { uniques?: number };
}
interface ZoneGraphQlResponse {
  data?: { viewer?: { zones?: Array<{ httpRequests1dGroups?: ZoneDayGroup[] }> } };
  errors?: Array<{ message: string }>;
}

/** Build the empty envelope (no creds / error / idle zone). */
function emptyEnvelope(zone: string, days: number): NetworkAnalytics {
  return {
    any_real_data: false,
    bytes: 0,
    page_views: 0,
    range_days: days,
    series: [],
    top_countries: [],
    total_requests: 0,
    unique_visitors: 0,
    zone,
  };
}

/**
 * Load zone-level analytics for the whole platform over `range`.
 *
 * KV-cached 5 minutes keyed by `network-analytics:{zone}:{range}`. Fail-soft:
 * returns the empty envelope (never throws) when credentials are missing or
 * the CF GraphQL call errors, so the dashboard always renders.
 *
 * @param env - Worker bindings (needs `CACHE_KV` + CF credentials).
 * @param range - One of `24h | 7d | 30d | 90d`.
 * @returns The zone envelope; `any_real_data` distinguishes real vs empty.
 *
 * @example
 * const net = await loadNetworkAnalytics(env, '7d');
 * // → { total_requests: 3_008_696, page_views: 78_463, unique_visitors: 2_163, … }
 */
export async function loadNetworkAnalytics(
  env: Env,
  range: NetworkRange,
): Promise<NetworkAnalytics> {
  const days = RANGE_TO_DAYS[range];
  const zoneId = env.CF_ZONE_ID || PROJECTSITES_ZONE_ID;
  const cacheKey = `network-analytics:${zoneId}:${range}`;

  try {
    const cached = await env.CACHE_KV.get(cacheKey, 'json');
    if (cached && typeof cached === 'object' && 'total_requests' in cached) {
      return cached as NetworkAnalytics;
    }
  } catch {
    /* cache miss fine */
  }

  // Zone-level analytics is platform-operator scope → worker global key only
  // (never per-org). resolveCfCredentials(env, null) skips the org lookup.
  const auth = await resolveCfCredentials(env, null);
  if (!auth) return emptyEnvelope('projectsites.dev', days);

  const envelope = await queryZone(auth, zoneId, days);

  try {
    // Cache real data 5 min; cache the empty envelope only 30s so a transient
    // credential/API blip clears fast instead of pinning "no data" for 5 min.
    await env.CACHE_KV.put(cacheKey, JSON.stringify(envelope), {
      expirationTtl: envelope.any_real_data ? 300 : 30,
    });
  } catch {
    /* */
  }
  return envelope;
}

/** Issue the zone-level GraphQL query and shape the envelope. Fail-soft. */
async function queryZone(auth: CfAuth, zoneId: string, days: number): Promise<NetworkAnalytics> {
  // `httpRequests1dGroups` filters on DATE strings (YYYY-MM-DD) and retains ~30
  // days of 1d rollups on the free plan; cap the window so a 90d request never
  // errors on retention (we still report the requested range_days for the UI).
  const windowDays = Math.min(days, 30);
  const nowMs = Date.now();
  const since = new Date(nowMs - (windowDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const until = new Date(nowMs).toISOString().slice(0, 10);

  const query = /* GraphQL */ `
    query NetworkTraffic($zoneTag: String!, $since: String!, $until: String!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1dGroups(
            limit: 31
            filter: { date_geq: $since, date_leq: $until }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum {
              requests
              pageViews
              bytes
              countryMap { clientCountryName requests }
            }
            uniq { uniques }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      body: JSON.stringify({ query, variables: { since, until, zoneTag: zoneId } }),
      headers: { ...cfAuthHeaders(auth), 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!res.ok) {
      console.warn(
        JSON.stringify({
          body: (await res.text()).slice(0, 300),
          level: 'warn',
          op: 'queryZone',
          service: 'network_analytics',
          status: res.status,
          zone: zoneId,
        }),
      );
      return emptyEnvelope('projectsites.dev', days);
    }
    const json = (await res.json()) as ZoneGraphQlResponse;
    if (json.errors?.length) {
      console.warn(
        JSON.stringify({
          graphql_errors: json.errors
            .map((e) => e.message)
            .join('; ')
            .slice(0, 300),
          level: 'warn',
          op: 'queryZone',
          service: 'network_analytics',
          zone: zoneId,
        }),
      );
      return emptyEnvelope('projectsites.dev', days);
    }
    const groups = json.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];

    const countries = new Map<string, number>();
    const series: NetworkSeriesPoint[] = [];
    let totalRequests = 0;
    let totalPageViews = 0;
    let totalUniques = 0;
    let totalBytes = 0;

    for (const g of groups) {
      const requests = Number(g.sum?.requests ?? 0);
      const pageViews = Number(g.sum?.pageViews ?? 0);
      const uniques = Number(g.uniq?.uniques ?? 0);
      totalRequests += requests;
      totalPageViews += pageViews;
      totalUniques += uniques;
      totalBytes += Number(g.sum?.bytes ?? 0);
      series.push({
        date: String(g.dimensions?.date ?? ''),
        page_views: pageViews,
        requests,
        unique_visitors: uniques,
      });
      for (const c of g.sum?.countryMap ?? []) {
        const name = String(c.clientCountryName ?? 'Unknown');
        countries.set(name, (countries.get(name) ?? 0) + Number(c.requests ?? 0));
      }
    }

    const topCountries = [...countries.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([country, requests]) => ({ country, requests }));

    return {
      any_real_data: totalRequests > 0,
      bytes: totalBytes,
      page_views: totalPageViews,
      range_days: days,
      series,
      top_countries: topCountries,
      total_requests: totalRequests,
      unique_visitors: totalUniques,
      zone: 'projectsites.dev',
    };
  } catch (err) {
    console.warn(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
        level: 'warn',
        op: 'queryZone',
        service: 'network_analytics',
        zone: zoneId,
      }),
    );
    return emptyEnvelope('projectsites.dev', days);
  }
}
