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
 * deterministic RDAP fan-out, KV-cached with a 20-deep concurrency window so
 * we stay polite to public RDAP endpoints. Cache TTL is split by verdict
 * confidence: definitive `available`/`taken` cache for 1h, but a transient
 * `unknown` caches for only 60s so a momentary registry/egress hiccup never
 * poisons a domain as "couldn't check" for a full hour.
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
/**
 * Cache TTL for a DEFINITIVE verdict (`available` / `taken`) — 1h. These answers
 * don't change minute-to-minute, so a long TTL keeps us polite to registries.
 */
const CACHE_TTL_S = 3600;
/**
 * Cache TTL for a NON-DEFINITIVE verdict (`unknown` from rate-limit / timeout /
 * registry hiccup) — 60s. A transient failure must NOT poison a domain as
 * "couldn't check" for a full hour: some registries (e.g. `.io`, `.xyz`) or the
 * shared Worker egress IP throttle intermittently, and a 1h TTL on that stale
 * `unknown` makes the picker render "? couldn't check" long after the registry
 * recovered. A short TTL lets the next probe re-resolve to a real answer within
 * a minute while still absorbing a retry storm. (Incident: `/api/domains/search`
 * returned all-`unknown` for a candidate set that was actually resolvable — the
 * verdicts were stale poisoned cache from a momentary probe failure.)
 */
const CACHE_TTL_UNKNOWN_S = 60;
const CONCURRENCY = 20;

export type RdapStatus = 'available' | 'taken' | 'unknown';
export type RdapSource = 'rdap' | 'rdap-cache' | 'rdap-error';

export interface RdapResult {
  domain: string;
  available: boolean;
  status: RdapStatus;
  source: RdapSource;
}

/** Per-attempt abort budget for one rdap.org probe (ms). */
const RDAP_TIMEOUT_MS = 5000;

/**
 * One RDAP probe attempt against the `rdap.org` bootstrap aggregator.
 *
 * @param normalized - Already trimmed + lowercased domain.
 * @returns The verdict for THIS attempt — `available` (404), `taken` (200), or
 *   `unknown` on any other status / timeout / network throw.
 * @remarks Impure — one `fetch` to `rdap.org`. Split out from
 *   {@link checkAvailability} so a transient `unknown` can be retried once
 *   without duplicating the request/parse/catch shape.
 */
async function probeOnce(normalized: string): Promise<RdapResult> {
  try {
    const res = await fetch(`${RDAP_BASE}/${encodeURIComponent(normalized)}`, {
      method: 'GET',
      headers: {
        'User-Agent': REAL_UA,
        Accept: 'application/rdap+json, application/json;q=0.9, */*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      // rdap.org has slow periods (>5s for some TLDs) — abort so one hung
      // registry can't stall the 20-wide batch. A transient abort is retried
      // once by the caller.
      signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
    });

    if (res.status === 404) {
      return { domain: normalized, available: true, status: 'available', source: 'rdap' };
    }
    if (res.status === 200) {
      return { domain: normalized, available: false, status: 'taken', source: 'rdap' };
    }
    // 429 (rate-limit) / 503 (maintenance) / 403 (rdap.org's Cloudflare edge
    // challenging this Worker→CF subrequest) / any unexpected status — neither
    // yes nor no. LOG the actual status: this path was previously a SILENT
    // `unknown`, so nothing distinguished a slow registry from a hard block. A
    // persistent non-ok status here (esp. 403/429) means the aggregator is
    // refusing the Worker's egress, which a retry can't fix (→ needs a different
    // source). Per structured-logging: no silent unknown.
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'rdap_availability',
        message: 'rdap probe non-ok status',
        domain: normalized,
        status: res.status,
      }),
    );
    return { domain: normalized, available: false, status: 'unknown', source: 'rdap-error' };
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
    return { domain: normalized, available: false, status: 'unknown', source: 'rdap-error' };
  }
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
 * - A transient `unknown` is retried ONCE (an independent second draw) before
 *   the sad verdict is cached — rdap.org's timeouts are per-request-variable.
 *
 * Results are cached in `CACHE_KV` keyed `rdap:{domain}` (definitive 1h,
 * `unknown` 60s) so a user paging through suggestions doesn't re-hit the
 * registry on every keystroke.
 */
export async function checkAvailability(env: Env, domain: string): Promise<RdapResult> {
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

  // Probe once; retry a NON-DEFINITIVE `unknown` exactly ONCE. rdap.org's failures
  // here are per-request-variable timeouts (the aggregator has slow spells where the
  // SAME TLD aborts on one draw and answers in <1s on the next), NOT a hard block —
  // so an independent second attempt frequently resolves it. A definitive
  // `available`/`taken` never retries (the answer is already authoritative), and the
  // retry runs sequentially inside this worker slot so it never widens batch concurrency.
  let result = await probeOnce(normalized);
  if (result.status === 'unknown') {
    const retry = await probeOnce(normalized);
    if (retry.status !== 'unknown') result = retry;
  }

  // Cache happy + sad paths so we don't hammer registries on retry storms — but
  // a non-definitive `unknown` gets a SHORT TTL so a transient failure self-heals
  // in ~60s instead of poisoning the domain as "couldn't check" for a full hour.
  try {
    await env.CACHE_KV.put(cacheKey, JSON.stringify(result), {
      expirationTtl: result.status === 'unknown' ? CACHE_TTL_UNKNOWN_S : CACHE_TTL_S,
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
export async function checkBatch(env: Env, domains: string[]): Promise<RdapResult[]> {
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
