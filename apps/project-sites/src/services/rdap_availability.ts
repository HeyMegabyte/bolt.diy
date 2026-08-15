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

/** One probe's verdict plus whether the caller should retry it (transient only). */
interface ProbeAttempt {
  result: RdapResult;
  /** True ONLY for a timeout/network failure — the genuinely transient case. A
   *  status-refusal (429 rate-limit / 403 block / 5xx) is NOT retryable: an
   *  immediate re-request just adds load to an endpoint already refusing us. */
  retryable: boolean;
}

/**
 * One RDAP probe attempt against the `rdap.org` bootstrap aggregator.
 *
 * @param normalized - Already trimmed + lowercased domain.
 * @returns `{ result, retryable }` — the verdict plus whether a retry is warranted.
 *   `available` (404) / `taken` (200) are definitive (not retryable); a non-ok
 *   status is `unknown` + NOT retryable (the server refused); a timeout/network
 *   throw is `unknown` + retryable (per-request-variable, worth a second draw).
 * @remarks Impure — one `fetch` to `rdap.org`. Split out from
 *   {@link checkAvailability} so a transient `unknown` can be retried once
 *   without duplicating the request/parse/catch shape.
 */
async function probeOnce(normalized: string): Promise<ProbeAttempt> {
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
      return { result: { domain: normalized, available: true, status: 'available', source: 'rdap' }, retryable: false };
    }
    if (res.status === 200) {
      return { result: { domain: normalized, available: false, status: 'taken', source: 'rdap' }, retryable: false };
    }
    // 429 (rate-limit) / 503 (maintenance) / 403 (rdap.org's Cloudflare edge
    // challenging this Worker→CF subrequest) / any unexpected status — neither
    // yes nor no, and NOT retryable: the server RESPONDED with a refusal, so an
    // immediate re-request just deepens a rate-limit. LOG the actual status —
    // this path was previously a SILENT `unknown`, so nothing distinguished a
    // slow registry from a hard block. A persistent 403/429 means the aggregator
    // is refusing the Worker's egress (→ needs a different source, per
    // structured-logging: no silent unknown).
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'rdap_availability',
        message: 'rdap probe non-ok status',
        domain: normalized,
        status: res.status,
      }),
    );
    return { result: { domain: normalized, available: false, status: 'unknown', source: 'rdap-error' }, retryable: false };
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
    // Timeout / network throw — the genuinely transient, per-request-variable
    // case → retryable (an independent second draw often lands fast).
    return { result: { domain: normalized, available: false, status: 'unknown', source: 'rdap-error' }, retryable: true };
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
 * - A TIMEOUT/network `unknown` is retried ONCE (an independent second draw) —
 *   rdap.org's timeouts are per-request-variable. A STATUS refusal (429/403) is
 *   NOT retried (an immediate re-request just deepens the rate-limit).
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

  // Probe once; retry ONLY a RETRYABLE unknown (a timeout/network throw) exactly
  // once. rdap.org's transient failures are per-request-variable timeouts (the same
  // TLD aborts on one draw, answers in <1s on the next) → an independent second draw
  // resolves them. A status-refusal (429 rate-limit / 403 edge-block, observed live)
  // is NOT retried — the aggregator RESPONDED "no", so an immediate re-request just
  // deepens the rate-limit. Definitive answers never retry. The retry runs
  // sequentially inside this worker slot so it never widens batch concurrency.
  const first = await probeOnce(normalized);
  let result = first.result;
  if (result.status === 'unknown' && first.retryable) {
    const retry = await probeOnce(normalized);
    if (retry.result.status !== 'unknown') result = retry.result;
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
