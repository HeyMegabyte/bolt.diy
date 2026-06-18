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
import { searchPlacesByQuery } from '../services/places_search.js';
import { scanResultsToLeads } from '../services/lead_scan.js';
import { createLead } from '../services/lead_store.js';
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
  const userId = c.get('userId');
  if (!userId) {
    return c.json(errorBody('UNAUTHORIZED', 'Sign in required', requestId), 401);
  }

  // Flag gate — 404 (not 403) when off so the route's existence isn't leaked.
  if (!(await isFlagOn(c.env, LEAD_SCANNER_FLAG, { orgId: c.get('orgId'), userId }))) {
    return c.json(errorBody('NOT_FOUND', 'Not found', requestId), 404);
  }

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
