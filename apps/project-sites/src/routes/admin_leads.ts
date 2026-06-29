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
import { tryEmitEvent } from '../services/emit_event.js';
import { createClaimLink } from '../services/claim_links.js';
import type { PlacesResult } from '../services/google_places.js';
import type { PlacesSearchHit } from '../services/places_search.js';
import { discoverSitelessFromOsm } from '../services/osm_overpass.js';
import { runScan, crmSink } from '../services/lead_scan_orchestrator.js';
import { upsertLeadToCrm } from '../services/crm_leads.js';
import { enrichEmail } from '../services/email_enrich.js';

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

  // Emit a lead.discovered batch event onto the durable bus when the scan added
  // leads — feeds Tinybird analytics + Hatchet outreach orchestration. Idempotent
  // per requestId (a retried scan request never double-emits); never throws.
  if (summary.created > 0) {
    await tryEmitEvent(
      c.env,
      {
        type: 'lead.discovered',
        producer: 'worker',
        tenantId: c.get('orgId') ?? 'platform',
        traceId: requestId ?? `scan_${parsed.data.query}`,
        ...(userIdOf(c) ? { userId: userIdOf(c) } : {}),
        data: {
          query: parsed.data.query,
          scanned: summary.scanned,
          created: summary.created,
          onlyNoWebsite: parsed.data.onlyNoWebsite ?? true,
        },
      },
      { scope: [requestId ?? parsed.data.query] },
    );
  }

  return c.json({ summary }, 200);
});

/** The authed user id (set by gateLeadScanner upstream), or undefined. */
function userIdOf(c: import('hono').Context<{ Bindings: Env; Variables: Variables }>) {
  return c.get('userId') ?? undefined;
}

const OsmScanBodySchema = z
  .object({
    /** Bounding box [south, west, north, east]. */
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    /** OSM category keys (default shop/craft/office/amenity). */
    categories: z.array(z.string().min(1)).max(12).optional(),
    /** Cap leads sunk to the CRM this run (budget guard). */
    maxLeads: z.number().int().min(1).max(500).optional(),
  })
  .strict();

/**
 * `POST /api/admin/leads/scan-osm` — the AUTOMATIC engine's keystone route: free
 * OSM Overpass discovery of siteless businesses → email enrich → propensity score
 * + rank → Twenty CRM sink ({@link crmSink}). Same super-admin + `lead_scanner`
 * flag gate as the legacy Places scan. Reads OSM (free) + writes the CRM; sends
 * no outreach. Returns the {@link ScanRunSummary}. Leads land in
 * crm.projectsites.dev (deduped on externalId).
 */
adminLeads.post('/api/admin/leads/scan-osm', async (c) => {
  const requestId = c.get('requestId');
  const blocked = await gateLeadScanner(c);
  if (blocked) return blocked;

  const raw = await c.req.json().catch(() => ({}));
  const parsed = OsmScanBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      errorBody('VALIDATION_ERROR', 'Invalid OSM scan request (need bbox)', requestId),
      400,
    );
  }

  const summary = await runScan(
    {
      discover: (profile) =>
        discoverSitelessFromOsm({
          bbox: parsed.data.bbox,
          ...(parsed.data.categories ? { categories: parsed.data.categories } : {}),
        }).then((list) => list.map((b) => ({ ...b, signalHints: { sourceCount: 1 } }))),
      enrich: (cand) => enrichEmail({ listingEmail: cand.email ?? null }),
      sink: crmSink('osm', (payload) => upsertLeadToCrm(c.env, payload)),
    },
    {
      source: 'osm',
      addressSource: 'listing',
      ...(parsed.data.maxLeads ? { maxLeads: parsed.data.maxLeads } : {}),
    },
  );

  if (summary.upserted > 0) {
    await tryEmitEvent(
      c.env,
      {
        type: 'lead.discovered',
        producer: 'worker',
        tenantId: c.get('orgId') ?? 'platform',
        traceId: requestId ?? `osm_scan`,
        ...(userIdOf(c) ? { userId: userIdOf(c) } : {}),
        data: { source: 'osm', discovered: summary.discovered, upserted: summary.upserted },
      },
      { scope: [requestId ?? `osm_${parsed.data.bbox.join(',')}`] },
    );
  }

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
