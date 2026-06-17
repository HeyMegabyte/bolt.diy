/**
 * claimyour.site — the claim-link funnel route.
 *
 * @remarks
 * `GET /api/claim/:shortlink` is what a claim link points at. It:
 *  1. resolves the shortlink → lead (404 on an unknown link),
 *  2. records the click for attribution ({@link markClaimLinkClicked}),
 *  3. builds normalized {@link buildClaimAttribution} from utm/referer,
 *  4. opens (or reuses) the build session — `claim_${shortlink}` is deterministic
 *     so a refresh / re-click reuses the SAME session,
 *  5. on a fresh/failed session, fires `START_BUILD` (the reducer + store make a
 *     refresh a no-op → no duplicate build) and best-effort kicks the background
 *     build workflow,
 *  6. 302-redirects to the prefilled `/create?claim=<shortlink>` funnel.
 *
 * The build SURVIVES the user leaving the page because the session is persisted
 * `building` server-side here, not in the browser. The actual generation engine
 * consumes `building` sessions (separate slice); this route is the funnel + the
 * idempotent kickoff.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { resolveLeadByShortlink, markClaimLinkClicked } from '../services/claim_links.js';
import {
  loadOrCreateSession,
  applyClaimEvent,
  getSession,
} from '../services/claim_session_store.js';
import { canStartBuild } from '../services/claim_build_session.js';
import { buildClaimAttribution } from '../services/claim_attribution.js';
import { getLead } from '../services/lead_store.js';
import { toCreateFormPrefill } from '../services/claim_lead_profile.js';

export const claimRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

claimRoutes.get('/api/claim/:shortlink', async (c) => {
  const shortlink = c.req.param('shortlink');

  const link = await resolveLeadByShortlink(c.env.DB, shortlink);
  if (!link) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'This claim link is not valid.' } }, 404);
  }

  // Record the click (attribution) — best-effort, never blocks the funnel.
  try {
    await markClaimLinkClicked(c.env.DB, shortlink);
  } catch {
    /* click metrics are best-effort */
  }

  // Normalize where the click came from (utm_* + referer) for the build context.
  const attribution = buildClaimAttribution({
    shortlink,
    query: c.req.query() as Record<string, string | undefined>,
    referer: c.req.header('referer') ?? null,
    leadId: link.leadId,
  });

  // Deterministic session id → a refresh / re-click reuses the SAME session.
  const sessionId = `claim_${shortlink}`;
  const session = await loadOrCreateSession(c.env.DB, sessionId, link.leadId);

  if (canStartBuild(session)) {
    await applyClaimEvent(c.env.DB, sessionId, link.leadId, { type: 'START_BUILD' });
    // Best-effort background kick — survives page-leave; guarded so the route
    // works (and tests pass) without the SITE_WORKFLOW binding present.
    const wf = c.env.SITE_WORKFLOW;
    if (wf && typeof wf.create === 'function') {
      try {
        c.executionCtx?.waitUntil(
          wf.create({
            id: sessionId,
            params: { sessionId, leadId: link.leadId, shortlink, attribution },
          }),
        );
      } catch {
        /* the session is already 'building'; a consumer can pick it up */
      }
    }
  }

  // Send the visitor to the prefilled create funnel.
  return c.redirect(`/create?claim=${encodeURIComponent(shortlink)}`, 302);
});

/**
 * `GET /api/claim/:shortlink/profile` — the prefill payload the Angular `/create`
 * page fetches when opened via a claim link. Resolves the shortlink → lead →
 * researched profile, returns the flat form-prefill values + the live build
 * status (so the page can show "building…" while the background build runs).
 */
claimRoutes.get('/api/claim/:shortlink/profile', async (c) => {
  const shortlink = c.req.param('shortlink');
  const link = await resolveLeadByShortlink(c.env.DB, shortlink);
  if (!link) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'This claim link is not valid.' } }, 404);
  }
  const lead = await getLead(c.env.DB, link.leadId);
  if (!lead) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'This lead is no longer available.' } },
      404,
    );
  }
  const sessionId = `claim_${shortlink}`;
  const session = await getSession(c.env.DB, sessionId);
  return c.json({
    data: {
      prefill: toCreateFormPrefill(lead.profile),
      sessionId,
      buildStatus: session?.status ?? 'pending',
      previewUrl: session?.previewUrl ?? null,
    },
  });
});
