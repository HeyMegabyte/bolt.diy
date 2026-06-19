/**
 * Super-Admin lead scanner route (#9).
 *
 * `POST /api/admin/leads/scan` wires the lead-scanner pure cores into a single
 * HTTP surface: a Google Places text search → score + keep the no-website
 * businesses ({@link scanResultsToLeads}) → persist via {@link createLead}.
 *
 * Guards (in order): auth required (401) → flag-gated `lead_scanner` (404, never
 * 403) → Zod body. The scan only READS Places + CREATES leads; outreach send is
 * a separate, explicitly-enabled step (never auto-sends).
 *
 * @packageDocumentation
 */
import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { isSuperAdmin } from '../services/sysadmin.js';
import { searchPlacesByQuery } from '../services/places_search.js';
import { scanResultsToLeads } from '../services/lead_scan.js';
import { createLead, listLeads, getLead } from '../services/lead_store.js';
import { createClaimLink } from '../services/claim_links.js';
import type { PlacesResult } from '../services/google_places.js';
import type { PlacesSearchHit } from '../services/places_search.js';

/** Feature flag key gating this route. */
export const LEAD_SCANNER_FLAG = 'lead_scanner';

const ScanBodySchema = z
  .object({
    query: z.string().trim().min(2).max(200),
    onlyNoWebsite: z.boolean().optional(),
  })
  .strict();

const ListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    onlyNoWebsite: z
      .enum(['true', 'false', '1', '0'])
      .transform((v) => v === 'true' || v === '1')
      .optional(),
  })
  .strip();

/**
 * Run the auth → flag (404, never 403) → super-admin (403) gate chain shared by
 * every lead-scanner route. Returns a JSON error Response to short-circuit, or
 * `null` when the caller is an authorized super-admin.
 */
async function gateLeadScanner(
  c: import('hono').Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Response | null> {
  const requestId = c.get('requestId');
  const userId = c.get('userId');
  if (!userId) return c.json(errorBody('UNAUTHORIZED', 'Sign in required', requestId), 401);
  if (!(await isFlagOn(c.env, LEAD_SCANNER_FLAG, { orgId: c.get('orgId'), userId }))) {
    return c.json(errorBody('NOT_FOUND', 'Not found', requestId), 404);
  }
  if (!(await isSuperAdmin(c.env, userId))) {
    return c.json(errorBody('FORBIDDEN', 'Super-admin access required', requestId), 403);
  }
  return null;
}

/** Build the RFC7807-ish error envelope used across the worker. */
function errorBody(code: string, message: string, requestId: string | undefined) {
  return { error: { code, message, request_id: requestId ?? null } };
}

/**
 * Map a lightweight Places text-search hit to the fuller {@link PlacesResult}
 * shape the scorer/scanner expects. Text search does not return phone/website/
 * maps_url (those need Place Details), so those are null — which is correct for
 * the no-website scanner intent.
 */
function hitToResult(h: PlacesSearchHit): PlacesResult {
  return {
    place_id: h.place_id,
    name: h.name,
    formatted_address: h.formatted_address,
    phone: null,
    website: null,
    rating: h.rating,
    review_count: h.reviewCount,
    hours: null,
    geo: null,
    maps_url: null,
    photos: [],
    types: h.types,
    price_level: null,
    reviews: [],
    business_status: h.businessStatus,
  };
}

export const adminLeads = new Hono<{ Bindings: Env; Variables: Variables }>();

adminLeads.post('/api/admin/leads/scan', async (c) => {
  const requestId = c.get('requestId');
  const blocked = await gateLeadScanner(c);
  if (blocked) return blocked;

  const raw = await c.req.json().catch(() => ({}));
  const parsed = ScanBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(errorBody('VALIDATION_ERROR', 'Invalid scan request', requestId), 400);
  }

  const hits = await searchPlacesByQuery(c.env.GOOGLE_PLACES_API_KEY, parsed.data.query);
  const results = hits.map(hitToResult);

  const summary = await scanResultsToLeads(
    results,
    { createLead: (profile, meta) => createLead(c.env.DB, profile, meta) },
    parsed.data.onlyNoWebsite === undefined ? {} : { onlyNoWebsite: parsed.data.onlyNoWebsite },
  );

  return c.json({ summary }, 200);
});

/**
 * `GET /api/admin/leads` — list scanned leads (highest score first) for the
 * Super-Admin scanner UI. Same gate chain as the scan route. Read-only; returns
 * lightweight {@link LeadSummary} rows (no per-row profile JSON parse).
 * Query params: `limit` (1..200, default 50), `offset` (≥0), `onlyNoWebsite`.
 */
adminLeads.get('/api/admin/leads', async (c) => {
  const requestId = c.get('requestId');
  const blocked = await gateLeadScanner(c);
  if (blocked) return blocked;

  const parsed = ListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(errorBody('VALIDATION_ERROR', 'Invalid list query', requestId), 400);
  }

  const leads = await listLeads(c.env.DB, {
    ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
    ...(parsed.data.offset === undefined ? {} : { offset: parsed.data.offset }),
    ...(parsed.data.onlyNoWebsite === undefined
      ? {}
      : { onlyNoWebsite: parsed.data.onlyNoWebsite }),
  });

  return c.json({ leads, count: leads.length }, 200);
});

/**
 * `POST /api/admin/leads/:id/claim-link` — mint a shareable claim link for a
 * scanned lead (the "+ claim links" half of #9: outreach embeds this URL; the
 * recipient lands in the prefilled claim funnel). Same gate chain. Verifies the
 * lead exists first (404 — never mint a link to a junk lead). The returned URL
 * resolves at `GET /api/claim/:shortlink`.
 */
adminLeads.post('/api/admin/leads/:id/claim-link', async (c) => {
  const requestId = c.get('requestId');
  const blocked = await gateLeadScanner(c);
  if (blocked) return blocked;

  const leadId = c.req.param('id');
  const lead = await getLead(c.env.DB, leadId);
  if (!lead) {
    return c.json(errorBody('NOT_FOUND', 'Lead not found', requestId), 404);
  }

  const { token } = await createClaimLink(c.env.DB, leadId);
  return c.json({ token, claimUrl: `https://projectsites.dev/api/claim/${token}` }, 200);
});
