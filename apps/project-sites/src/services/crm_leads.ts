/**
 * CRM lead sink — pushes scanned, scored leads into Twenty CRM
 * (crm.projectsites.dev) instead of a bespoke D1 table.
 *
 * @remarks
 * AGPL ISOLATION: Twenty is AGPL-licensed. This module talks to it over an HTTP
 * boundary ONLY — no `@twenty/*` package, no shared SDK, no imported types. Every
 * request/response shape is declared LOCALLY here. The Worker env carries only
 * HTTP coordinates (`TWENTY_API_URL`, `TWENTY_API_KEY`). See rule
 * `agpl-isolation-via-http-boundary`.
 *
 * The {@link leadToCrmCompany} mapper is PURE (testable, no I/O). The
 * {@link upsertLeadToCrm} client is a thin, never-throw `fetch` wrapper that
 * no-ops (skipped) when the CRM is not configured — so the scanner runs dark
 * until `TWENTY_API_URL` + `TWENTY_API_KEY` are set.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import type { LeadSignals, OutreachChannel, PropensityTier } from './lead_propensity.js';
import { payPropensity, contactConfidence } from './lead_propensity.js';

/** A discovered business (locally declared — never a Twenty type). */
export interface DiscoveredBusiness {
  businessName: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  category?: string | null;
  mapsUrl?: string | null;
  /** Stable external id (e.g. google place_id) for dedupe on the CRM side. */
  externalId?: string | null;
}

/** The local payload we POST to Twenty's REST `companies` resource. */
export interface CrmLeadPayload {
  /** Twenty Company.name */
  name: string;
  /** Free-text address line (Twenty `address` or a custom field). */
  address?: string;
  /** Phone (Twenty `phone`). */
  phone?: string;
  /** Work email (custom field). */
  email?: string;
  /** Custom scanner fields — all flat scalars Twenty accepts on a custom object. */
  leadScore: number;
  payTier: PropensityTier;
  emailConfidence: number;
  addressConfidence: number;
  outreachChannel: OutreachChannel;
  hasWebsite: boolean;
  category?: string;
  mapsUrl?: string;
  source: string;
  externalId?: string;
}

/** Result of an upsert attempt — never throws. */
export interface CrmUpsertResult {
  ok: boolean;
  /** True when the CRM is not configured (dark) — not an error. */
  skipped: boolean;
  id?: string;
  status?: number;
  error?: string;
}

/** Whether the Twenty CRM HTTP coordinates are configured. */
export function isCrmConfigured(env: Env): boolean {
  return Boolean(env.TWENTY_API_URL && env.TWENTY_API_KEY);
}

/**
 * Map a discovered business + its scored signals into the local CRM payload.
 *
 * Pure: no env, no I/O. Optional fields are omitted (not sent as empty strings)
 * so the CRM keeps clean records. Scoring is recomputed from `signals` so the
 * payload always carries a consistent score/tier/confidence triple.
 *
 * @param biz     - The discovered business.
 * @param signals - The scoring signals for {@link payPropensity}.
 * @param source  - Provenance label (e.g. 'google_places', 'osm', 'sos_oh').
 * @returns A {@link CrmLeadPayload} ready for {@link upsertLeadToCrm}.
 *
 * @example
 * ```ts
 * const payload = leadToCrmCompany(
 *   { businessName: "Joe's Plumbing", phone: '+12015551234' },
 *   { hasWebsite: false, emailSource: 'listing', category: 'plumber' },
 *   'google_places',
 * );
 * // { name: "Joe's Plumbing", phone: '...', leadScore: 62, payTier: 'B', ... }
 * ```
 */
export function leadToCrmCompany(
  biz: DiscoveredBusiness,
  signals: LeadSignals,
  source: string,
): CrmLeadPayload {
  const prop = payPropensity(signals);
  const contact = contactConfidence(signals);

  const payload: CrmLeadPayload = {
    name: biz.businessName,
    leadScore: prop.score,
    payTier: prop.tier,
    emailConfidence: contact.emailConfidence,
    addressConfidence: contact.addressConfidence,
    outreachChannel: contact.channel,
    hasWebsite: signals.hasWebsite,
    source,
  };
  if (biz.address) payload.address = biz.address;
  if (biz.phone) payload.phone = biz.phone;
  if (biz.email) payload.email = biz.email;
  if (biz.category) payload.category = biz.category;
  if (biz.mapsUrl) payload.mapsUrl = biz.mapsUrl;
  if (biz.externalId) payload.externalId = biz.externalId;
  return payload;
}

/**
 * Upsert a lead into Twenty CRM over the HTTP boundary.
 *
 * @remarks
 * Never throws. Returns `{ skipped: true }` when the CRM is unconfigured (dark
 * launch). On a network/HTTP error returns `{ ok: false, error }`. The exact
 * Twenty endpoint is a thin POST to `${TWENTY_API_URL}/rest/companies`; if the
 * workspace models leads as a custom object, only this one function changes.
 *
 * @param env     - Worker env (HTTP coordinates only).
 * @param payload - The local {@link CrmLeadPayload}.
 * @param fetchImpl - Injectable fetch (tests pass a stub); defaults to global fetch.
 * @returns A {@link CrmUpsertResult}.
 */
export async function upsertLeadToCrm(
  env: Env,
  payload: CrmLeadPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<CrmUpsertResult> {
  if (!isCrmConfigured(env)) {
    return { ok: false, skipped: true };
  }
  const base = env.TWENTY_API_URL!.replace(/\/+$/, '');
  try {
    const res = await fetchImpl(`${base}/rest/companies`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TWENTY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, skipped: false, status: res.status, error: `HTTP ${res.status}` };
    }
    const body = (await res.json().catch(() => ({}))) as { data?: { id?: string }; id?: string };
    const id = body?.data?.id ?? body?.id;
    return id ? { ok: true, skipped: false, id } : { ok: true, skipped: false };
  } catch (err) {
    return { ok: false, skipped: false, error: err instanceof Error ? err.message : 'fetch failed' };
  }
}
