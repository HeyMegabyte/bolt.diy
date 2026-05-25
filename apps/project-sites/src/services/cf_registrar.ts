/**
 * Cloudflare Registrar API client — domain-check pricing + register.
 *
 * @remarks
 * Why this replaces the prior Domainr + `CLOUDFLARE_REGISTRAR_API`
 * split: CF Registrar exposes two endpoints we need with the worker's
 * existing global-key/Bearer auth (no extra registrar-scoped token to
 * provision):
 *
 *   • `POST /accounts/:id/registrar/domain-check` — up to 20 FQDNs per
 *     call. Returns `{ name, registrable, pricing: { registration_cost,
 *     renewal_cost, currency } }` so we get availability AND USD
 *     pricing AND the "CF can sell me this TLD" flag in ONE call.
 *   • `POST /accounts/:id/registrar/registrations` — registers a new
 *     domain end-to-end. Bills the account at-cost.
 *
 * Availability is primarily proven by free RDAP probes (see
 * {@link services/rdap_availability.ts}); CF `domain-check` runs in
 * parallel as a pricing-enrichment layer. RDAP is the keystone because
 * it is free, IETF-standard (RFC 7480), and ICANN is sunsetting WHOIS
 * for it by August 2026 — Domainr's $20/mo RapidAPI proxy is obsolete.
 *
 * When CF auth is missing OR `domain-check` fails OR the TLD isn't
 * carried by CF, the route falls back to a static per-TLD price hint
 * and surfaces a Porkbun deeplink so the user still has a one-click
 * happy path for unsupported TLDs.
 */

import type { Env } from '../types/env.js';

const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CF_API = 'https://api.cloudflare.com/client/v4';

/**
 * Static fallback annual-price table for TLDs CF Registrar carries
 * (approximate, USD, used when `domain-check` is unauthenticated or
 * unavailable). Prices may drift; the live `domain-check` call always
 * wins when it succeeds.
 */
const STATIC_TLD_PRICE_USD_YR: Record<string, number> = {
  com: 10,
  net: 12,
  org: 11,
  info: 12,
  biz: 14,
  co: 25,
  me: 17,
  io: 35,
  ai: 70,
  dev: 13,
  app: 14,
  page: 11,
};

/**
 * TLDs CF Registrar is known NOT to carry — these get the Porkbun
 * fallback even before we hit the live API. Cuts wasted CF calls.
 */
const CF_UNSUPPORTED_TLDS = new Set(['xyz', 'shop', 'store', 'online', 'site']);

export interface DomainCheckResult {
  name: string;
  registrable: boolean;
  /** Annual registration cost in USD, null when CF can't price it. */
  price_usd_yr: number | null;
  /** True when CF carries this TLD (i.e. `registrable === true` OR pricing exists). */
  cf_carries: boolean;
  /** "standard" | "premium" — premium TLDs cost dramatically more. */
  tier?: 'standard' | 'premium';
  /** Why CF says it's unregistrable (e.g. "tld_not_supported"). */
  reason?: string;
}

export interface RegisterContact {
  /** Full registrant name (preferred). */
  name?: string;
  /** Legacy field — first half of registrant name. */
  first_name?: string;
  /** Legacy field — second half of registrant name. */
  last_name?: string;
  email: string;
  phone: string; // E.164
  organization?: string;
  /** Street address (preferred — `address` accepted as legacy alias). */
  street?: string;
  /** Legacy alias for `street`. */
  address?: string;
  city: string;
  state: string;
  /** Postal code (preferred — `zip` accepted as legacy alias). */
  postal_code?: string;
  /** Legacy alias for `postal_code`. */
  zip?: string;
  /** ISO 3166-1 alpha-2 (preferred — `country` accepted as legacy alias). */
  country_code?: string;
  /** Legacy alias for `country_code`. */
  country?: string;
}

export type RegisterErrorCode =
  | 'TLD_NOT_SUPPORTED'
  | 'CF_AUTH_MISSING'
  | 'CF_API_ERROR'
  | 'INVALID_DOMAIN';

export interface RegisterResult {
  ok: boolean;
  domain: string;
  /** Workflow polling URL — CF returns 202 + a `links.self` for async registration. */
  poll_url?: string;
  state?: 'pending' | 'in_progress' | 'action_required' | 'blocked' | 'succeeded' | 'failed';
  /** Legacy field — mirrors `poll_url` when sync registration returned an id. */
  transaction_id?: string;
  error?: RegisterErrorCode;
  message?: string;
  fallback_url?: string;
  cf_body?: unknown;
}

/**
 * Back-compat pricing-row shape used by sibling modules (`domain_purchase.ts`,
 * `domain_suggester.ts`) that were built against an earlier draft of this
 * service. Mirrors the older Domainr-style `{registration_price_usd_yr,
 * can_register}` shape.
 */
export interface TldPricing {
  tld: string;
  supported: boolean;
  registration_price_usd_yr: number | null;
  renewal_price_usd_yr: number | null;
  can_register: boolean;
  can_transfer: boolean;
}

/**
 * Back-compat helper — returns the static per-TLD price table keyed by TLD.
 *
 * @remarks
 * The earlier draft assumed CF published an unauthenticated TLD list at
 * `/registrar/tlds`. That endpoint doesn't exist — the authoritative
 * pricing source is `POST /domain-check` (Bearer-auth, per-domain).
 * This shim returns the static fallback table so sibling code keeps
 * compiling; new callers should use {@link checkDomains} for live
 * pricing instead.
 */
export async function buildTldPriceMap(_env: Env): Promise<Map<string, TldPricing>> {
  const m = new Map<string, TldPricing>();
  for (const [tld, price] of Object.entries(STATIC_TLD_PRICE_USD_YR)) {
    m.set(tld, {
      tld,
      supported: true,
      registration_price_usd_yr: price,
      renewal_price_usd_yr: price,
      can_register: !isKnownUnsupportedTld(tld),
      can_transfer: true,
    });
  }
  return m;
}

/**
 * Build the Porkbun fallback search/checkout deeplink for any domain.
 */
export function porkbunFallback(domain: string): string {
  return `https://porkbun.com/checkout/search?q=${encodeURIComponent(domain)}`;
}

/**
 * Return the static per-TLD price hint (or `null`) when CF auth is
 * missing and we can't ask the live endpoint.
 */
export function staticTldPriceUsd(tld: string): number | null {
  return STATIC_TLD_PRICE_USD_YR[tld.toLowerCase()] ?? null;
}

/**
 * Returns true when we know up-front CF Registrar doesn't carry the TLD.
 */
export function isKnownUnsupportedTld(tld: string): boolean {
  return CF_UNSUPPORTED_TLDS.has(tld.toLowerCase());
}

/**
 * Resolve the auth header pair for CF Registrar calls.
 *
 * @remarks
 * Prefers Bearer-token auth (`CF_API_TOKEN`) when available; falls back
 * to the legacy global-key pair (`CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`).
 * Returns `null` when neither is present — caller surfaces a graceful
 * "auth missing" error.
 */
function buildAuthHeaders(env: Env): Record<string, string> | null {
  if (env.CF_API_TOKEN) {
    return { Authorization: `Bearer ${env.CF_API_TOKEN}` };
  }
  if (env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_EMAIL) {
    return {
      'X-Auth-Email': env.CLOUDFLARE_EMAIL,
      'X-Auth-Key': env.CLOUDFLARE_API_KEY,
    };
  }
  return null;
}

/**
 * Batch-check availability + USD pricing for up to 20 FQDNs in one call.
 *
 * @returns Per-domain rows. Falls back to static-price hints + cf_carries
 *   inference when the CF call fails (e.g. auth missing) so the picker
 *   still has a price chip to render.
 */
export async function checkDomains(
  env: Env,
  domains: string[],
  accountId: string,
): Promise<DomainCheckResult[]> {
  const lc = domains.map((d) => d.trim().toLowerCase()).slice(0, 20);
  if (lc.length === 0) return [];

  const auth = buildAuthHeaders(env);
  if (!auth) {
    // No CF auth — fall back to static price table.
    return lc.map((name) => fallbackCheckResult(name));
  }

  try {
    const res = await fetch(
      `${CF_API}/accounts/${encodeURIComponent(accountId)}/registrar/domain-check`,
      {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': 'application/json',
          'User-Agent': REAL_UA,
        },
        body: JSON.stringify({ domains: lc }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      result?: {
        domains?: Array<{
          name?: string;
          registrable?: boolean;
          tier?: 'standard' | 'premium';
          reason?: string;
          pricing?: {
            currency?: string;
            registration_cost?: string | number;
          };
        }>;
      };
      errors?: Array<{ message?: string }>;
    };
    if (!res.ok || body.success === false) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'cf_registrar',
          message: 'domain-check failed; falling back to static pricing',
          status: res.status,
          cf_error: body.errors?.[0]?.message,
        }),
      );
      return lc.map((name) => fallbackCheckResult(name));
    }

    const byName = new Map<string, DomainCheckResult>();
    for (const row of body.result?.domains || []) {
      const name = (row.name || '').toLowerCase();
      if (!name) continue;
      const priceRaw = row.pricing?.registration_cost;
      const price = priceRaw != null ? Number(priceRaw) : null;
      byName.set(name, {
        name,
        registrable: !!row.registrable,
        price_usd_yr: Number.isFinite(price) ? Math.round(price as number) : null,
        cf_carries: !!row.registrable || row.reason !== 'tld_not_supported',
        tier: row.tier,
        reason: row.reason,
      });
    }
    // Make sure we return one row per input even if CF omitted some.
    return lc.map((name) => byName.get(name) || fallbackCheckResult(name));
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'cf_registrar',
        message: 'domain-check threw; falling back to static pricing',
        error: String(err),
      }),
    );
    return lc.map((name) => fallbackCheckResult(name));
  }
}

function fallbackCheckResult(name: string): DomainCheckResult {
  const tld = name.slice(name.lastIndexOf('.') + 1);
  const supported = !isKnownUnsupportedTld(tld);
  return {
    name,
    registrable: false, // availability proven separately via RDAP
    price_usd_yr: staticTldPriceUsd(tld),
    cf_carries: supported,
  };
}

/**
 * Register a new domain via CF Registrar.
 *
 * @remarks
 * Calls `POST /accounts/:id/registrar/registrations` with full registrant
 * contact. CF responds with 201 (synchronous success) or 202 + a
 * `links.self` poll URL (async workflow). The caller stores the poll URL
 * and surfaces a "registering…" pill until the workflow completes.
 *
 * `privacy_mode: 'redaction'` swaps in CF's proxy contact for the public
 * WHOIS while the real contact stays with CF. `auto_renew: true` is the
 * UX default — re-shipping a domain unintentionally is worse than the
 * billing surprise.
 */
export async function registerDomain(
  env: Env,
  opts: {
    domain: string;
    account_id: string;
    contact: RegisterContact;
    years?: number;
  },
): Promise<RegisterResult> {
  const domain = opts.domain.trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) {
    return { ok: false, domain, error: 'INVALID_DOMAIN', message: 'Domain must be a valid FQDN.' };
  }

  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (isKnownUnsupportedTld(tld)) {
    return {
      ok: false,
      domain,
      error: 'TLD_NOT_SUPPORTED',
      message: `Cloudflare Registrar doesn't carry .${tld}. Buy at Porkbun, then add via the custom-domain wizard.`,
      fallback_url: porkbunFallback(domain),
    };
  }

  const auth = buildAuthHeaders(env);
  if (!auth) {
    return {
      ok: false,
      domain,
      error: 'CF_AUTH_MISSING',
      message:
        'CF auth missing — set CF_API_TOKEN (or CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL) as worker secrets.',
    };
  }

  // Normalize legacy + canonical contact fields so callers built against
  // either shape keep working.
  const c = opts.contact;
  const fullName =
    c.name ||
    [c.first_name, c.last_name].filter(Boolean).join(' ').trim() ||
    'Site Owner';
  const street = c.street || c.address || '';
  const postalCode = c.postal_code || c.zip || '';
  const countryCode = (c.country_code || c.country || 'US').toUpperCase().slice(0, 2);

  const url = `${CF_API}/accounts/${encodeURIComponent(opts.account_id)}/registrar/registrations`;
  const payload = {
    domain_name: domain,
    privacy_mode: 'redaction' as const,
    auto_renew: true,
    years: opts.years ?? 1,
    contacts: {
      registrant: {
        email: c.email,
        phone: c.phone,
        postal_info: {
          name: fullName,
          organization: c.organization || undefined,
          address: {
            street,
            city: c.city,
            state: c.state,
            postal_code: postalCode,
            country_code: countryCode,
          },
        },
      },
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type': 'application/json',
        'User-Agent': REAL_UA,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: Array<{ code?: number; message?: string }>;
      result?: {
        completed?: boolean;
        state?: RegisterResult['state'];
        links?: { self?: string };
        error?: { code?: string; message?: string };
      };
    };

    if (!res.ok || body.success === false) {
      const firstErr = body.errors?.[0];
      const msg = firstErr?.message || body.result?.error?.message || `HTTP ${res.status}`;
      // CF returns specific error codes for unsupported TLDs.
      if (/tld.*not.*supported|unsupported.*tld/i.test(msg)) {
        return {
          ok: false,
          domain,
          error: 'TLD_NOT_SUPPORTED',
          message: `CF Registrar doesn't carry .${tld}. ${msg}`,
          fallback_url: porkbunFallback(domain),
        };
      }
      console.warn(
        JSON.stringify({
          level: 'error',
          service: 'cf_registrar',
          message: 'register failed',
          status: res.status,
          cf_code: firstErr?.code,
          cf_message: msg,
        }),
      );
      return {
        ok: false,
        domain,
        error: 'CF_API_ERROR',
        message: `CF Registrar register failed: ${msg}`,
        cf_body: body,
      };
    }

    const pollUrl = body.result?.links?.self;
    return {
      ok: true,
      domain,
      poll_url: pollUrl,
      // Legacy alias: a workflow poll URL doubles as a registration tx id.
      transaction_id: pollUrl ? pollUrl.split('/').filter(Boolean).pop() : undefined,
      state: body.result?.state || 'pending',
    };
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'cf_registrar',
        message: 'register error',
        error: String(err),
      }),
    );
    return {
      ok: false,
      domain,
      error: 'CF_API_ERROR',
      message: `Register call failed: ${String(err)}`,
    };
  }
}
