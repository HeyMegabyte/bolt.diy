/**
 * claimyour.site — the claim-link funnel route.
 *
 * @remarks
 * `GET /api/claim/:shortlink` is what a claim link points at. It:
 *  1. resolves the shortlink → lead (404 on an unknown link),
 *  2. records the click for attribution ({@link markClaimLinkClicked}),
 *  3. opens (or reuses) the build session — `claim_${shortlink}` is deterministic
 *     so a refresh / re-click reuses the SAME session,
 *  4. on a fresh/failed session, provisions a real site parented to the platform
 *     org ({@link createSite}), records its `siteId` on the session via
 *     `START_BUILD` (the reducer + store make a refresh a no-op → no duplicate
 *     build), and best-effort kicks the SITE_WORKFLOW with the site-shaped params
 *     it consumes ({@link buildClaimSiteParams}),
 *  5. 302-redirects to the prefilled `/create?claim=<shortlink>` funnel.
 *
 * The build SURVIVES the user leaving the page because the session is persisted
 * `building` server-side here. The build-status callback later resolves the
 * finished `siteId` back to this session ({@link getSessionBySiteId}) to flip
 * building→completed + email — see _LOOP_LEDGER fire-v2.51 (remaining wire).
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
import { getLead } from '../services/lead_store.js';
import { toCreateFormPrefill } from '../services/claim_lead_profile.js';
import { createSite } from '../services/site_create.js';
import { buildClaimSiteParams } from '../services/claim_site_params.js';

/**
 * The platform org that owns claim-built sites until the visitor signs in and
 * claims them (design option A — seeded by migration 0571; ownership transfers
 * to the user's org at claim time). A claim site is provisioned before the
 * visitor has an org, and `sites.org_id` is NOT NULL — so it parents here.
 */
export const PLATFORM_CLAIMS_ORG_ID = 'org_platform_claims';

/** Derive a collision-resistant site slug from a business name (+ short rand). */
function deriveClaimSlug(businessName: string): string {
  const base =
    businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'site';
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

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

  // Deterministic session id → a refresh / re-click reuses the SAME session.
  const sessionId = `claim_${shortlink}`;
  const session = await loadOrCreateSession(c.env.DB, sessionId, link.leadId);

  if (canStartBuild(session)) {
    // Provision a real site (parented to the platform org) so the SITE_WORKFLOW
    // gets the site-shaped params it actually consumes — then START_BUILD records
    // the siteId on the session (the link the build-status callback resolves back
    // to flip building→completed). Best-effort: any failure leaves the session
    // pending so a re-click retries; the funnel still redirects.
    const lead = await getLead(c.env.DB, link.leadId).catch(() => null);
    if (lead) {
      // Hono's `c.executionCtx` getter THROWS when no ExecutionContext exists
      // (e.g. unit tests) — resolve it safely once so a missing ctx just skips
      // analytics + the background kick instead of failing the whole build.
      let execCtx: ExecutionContext | undefined;
      try {
        execCtx = c.executionCtx;
      } catch {
        execCtx = undefined;
      }
      try {
        const slug = deriveClaimSlug(lead.profile.businessName);
        const site = await createSite(
          c.env,
          {
            orgId: PLATFORM_CLAIMS_ORG_ID,
            slug,
            businessName: lead.profile.businessName,
            businessPhone: lead.profile.phone ?? null,
            businessEmail: lead.profile.email ?? null,
            businessAddress: lead.profile.address ?? null,
          },
          { requestId: c.get('requestId'), executionCtx: execCtx },
        );

        await applyClaimEvent(c.env.DB, sessionId, link.leadId, {
          type: 'START_BUILD',
          siteId: site.id,
        });

        const wf = c.env.SITE_WORKFLOW;
        if (wf && typeof wf.create === 'function' && execCtx) {
          execCtx.waitUntil(
            wf
              .create({
                id: site.id,
                params: buildClaimSiteParams(lead.profile, {
                  siteId: site.id,
                  slug,
                  orgId: PLATFORM_CLAIMS_ORG_ID,
                }),
              })
              .catch(() => {
                /* session is already 'building'; the consumer can pick it up */
              }),
          );
        }
      } catch {
        /* createSite (e.g. slug collision) failed → leave pending; re-click retries */
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
