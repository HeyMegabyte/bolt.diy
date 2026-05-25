/**
 * RDAP-based domain availability checker.
 *
 * @remarks
 * Why RDAP beats Domainr: RDAP (RFC 7480) is the IETF-standard replacement
 * for WHOIS. Every TLD registry is required to implement it — ICANN is
 * sunsetting WHOIS by August 2026 in favor of RDAP. The free
 * `https://rdap.org/` bootstrap aggregator routes queries to the correct
 * authoritative registry, so a single `GET /domain/{name}` call returns
 * `404` for an unregistered domain and `200` (with full registration
 * record) for a registered one. Free, no API key, no quotas, IETF
 * standards-track. Domainr's RapidAPI proxy was $20/mo per 10k queries
 * and depended on an opaque third-party scraper. This module replaces
 * the entire Domainr two-step (`/v2/search` + `/v2/status`) with a
 * deterministic RDAP fan-out, KV-cached at 1h TTL with a 20-deep
 * concurrency window so we stay polite to public RDAP endpoints.
 */

import type { Env } from '../types/env.js';

/**
 * Realistic Chrome desktop UA per `~/.claude/plugins/heymegabyte-claude-skills/rules/fetch-defaults.md` —
 * default Workers/`undici` UAs get blocked by CDN bot management on some
 * registry RDAP endpoints (e.g. Verisign for `.com`).
 */
const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const RDAP_BASE = 'https://rdap.org/domain';
const CACHE_TTL_S = 3600;
const CONCURRENCY = 20;

export type RdapStatus = 'available' | 'taken' | 'unknown';
export type RdapSource = 'rdap' | 'rdap-cache' | 'rdap-error';

export interface RdapResult {
  domain: string;
  available: boolean;
  status: RdapStatus;
  source: RdapSource;
}

/**
 * Probe a single domain's availability via RDAP.
 *
 * @param env - Worker env (used for the `CACHE_KV` binding).
 * @param domain - Fully-qualified domain (e.g. `"vito.com"`).
 * @returns Availability verdict + source-of-truth tag.
 *
 * @remarks
 * Semantics:
 * - `404` from RDAP → unregistered → `available: true`
 * - `200` from RDAP → registered → `available: false`
 * - `429` / `503` (rate-limit or registry maintenance) → `unknown` so the
 *   UI can render a neutral "checking…" pill instead of a misleading
 *   "available" tick.
 * - Network errors collapse to `unknown` + `source: 'rdap-error'`.
 *
 * Results are cached for 1h in `CACHE_KV` keyed `rdap:{domain}` so a user
 * paging through suggestions doesn't re-hit the registry on every keystroke.
 */
export async function checkAvailability(
  env: Env,
  domain: string,
): Promise<RdapResult> {
  const normalized = domain.trim().toLowerCase();
  const cacheKey = `rdap:${normalized}`;

  try {
    const cached = await env.CACHE_KV.get(cacheKey, 'json');
    if (cached && typeof cached === 'object' && 'status' in cached) {
      const c = cached as RdapResult;
      return { ...c, source: 'rdap-cache' };
    }
  } catch {
    // KV miss is non-fatal — fall through to the live probe.
  }

  let result: RdapResult;
  try {
    const res = await fetch(`${RDAP_BASE}/${encodeURIComponent(normalized)}`, {
      method: 'GET',
      headers: {
        'User-Agent': REAL_UA,
        Accept: 'application/rdap+json, application/json;q=0.9, */*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      // RDAP queries are independent — short-circuit hung registries fast.
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 404) {
      result = { domain: normalized, available: true, status: 'available', source: 'rdap' };
    } else if (res.status === 200) {
      result = { domain: normalized, available: false, status: 'taken', source: 'rdap' };
    } else if (res.status === 429 || res.status === 503) {
      // Rate-limited or registry maintenance — neither yes nor no.
      result = { domain: normalized, available: false, status: 'unknown', source: 'rdap-error' };
    } else {
      // Unexpected status — treat as unknown rather than misleading the UI.
      result = { domain: normalized, available: false, status: 'unknown', source: 'rdap-error' };
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'rdap_availability',
        message: 'rdap probe failed',
        domain: normalized,
        error: String(err),
      }),
    );
    result = { domain: normalized, available: false, status: 'unknown', source: 'rdap-error' };
  }

  // Cache happy + sad paths so we don't hammer registries on retry storms.
  try {
    await env.CACHE_KV.put(cacheKey, JSON.stringify(result), {
      expirationTtl: CACHE_TTL_S,
    });
  } catch {
    // KV write failure is non-fatal.
  }

  return result;
}

/**
 * Fan out RDAP probes across a candidate list with bounded concurrency.
 *
 * @param env - Worker env (KV cache binding).
 * @param domains - Full FQDN list (e.g. `["vito.com", "vito.io", "vito.dev"]`).
 * @returns Results in the same order as the input.
 *
 * @remarks
 * 20-in-flight ceiling protects against public-RDAP rate limiting while
 * still letting the picker render its 10-domain suggestion list in
 * roughly one HTTP round-trip's worth of wall time.
 */
export async function checkBatch(
  env: Env,
  domains: string[],
): Promise<RdapResult[]> {
  const out: RdapResult[] = new Array(domains.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= domains.length) return;
      out[idx] = await checkAvailability(env, domains[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, domains.length) }, worker);
  await Promise.all(workers);
  return out;
}
