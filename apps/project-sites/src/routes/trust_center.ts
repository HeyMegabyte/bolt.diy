/**
 * @module routes/trust_center
 *
 * Trust Center API routes — idea #50.
 *
 * Mount path: `/api/trust`
 *
 * Routes:
 *   GET  /api/trust/profile               Get the org-level Trust profile
 *   PUT  /api/trust/profile               Update the org-level Trust profile
 *   POST /api/trust/profile/publish       Publish (flip 'published' = 1)
 *   GET  /api/trust/site/:siteId          Get effective profile for a site (override → org → 404)
 *   PUT  /api/trust/site/:siteId          Update the per-site override
 *   GET  /api/public/trust/:siteSlug      Public redacted view (rendered server-side)
 *
 * Every authenticated handler gates on `trust_center` feature flag — when
 * off, returns 404 (never 403, so feature existence does not leak).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  TrustProfileUpdateSchema,
  toPublicProfile,
  buildTrustJsonLd,
} from '../../libs/features/trust_center/feature.schemas.js';
import {
  getOrgProfile,
  getSiteProfile,
  getEffectiveProfileForSite,
  upsertProfile,
  publishOrgProfile,
  siteOrgId,
} from '../services/trust_center.js';
import { dbQueryOne } from '../services/db.js';

const FLAG_KEY = 'trust_center';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const trustCenter = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Shared guard: require auth + flag on. Returns Response when blocked, else null. */
async function guard(c: AppContext, siteId?: string): Promise<Response | null> {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  if (!userId || !orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  }
  const on = await isFlagOn(c.env, FLAG_KEY, { siteId, orgId });
  if (!on) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  return null;
}

// ─── GET /api/trust/profile (org-level) ─────────────────────────────────────

trustCenter.get('/api/trust/profile', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId')!;
  const profile = await getOrgProfile(c.env, orgId);
  return c.json({ data: profile });
});

// ─── PUT /api/trust/profile (org-level) ─────────────────────────────────────

trustCenter.put('/api/trust/profile', zValidator('json', TrustProfileUpdateSchema), async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId')!;
  const update = c.req.valid('json');
  const profile = await upsertProfile(c.env, {
    orgId,
    siteId: null,
    update,
  });
  return c.json({ data: profile });
});

// ─── POST /api/trust/profile/publish ────────────────────────────────────────

trustCenter.post('/api/trust/profile/publish', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId')!;
  const profile = await publishOrgProfile(c.env, orgId);
  if (!profile) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Trust profile not found — create one with PUT /api/trust/profile first.',
        },
      },
      404,
    );
  }
  return c.json({ data: profile });
});

// ─── GET /api/trust/site/:siteId ────────────────────────────────────────────

trustCenter.get('/api/trust/site/:siteId', async (c) => {
  const { siteId } = c.req.param();
  const blocked = await guard(c, siteId);
  if (blocked) return blocked;
  const orgId = c.get('orgId')!;
  const profile = await getEffectiveProfileForSite(c.env, orgId, siteId);
  return c.json({ data: profile });
});

// ─── PUT /api/trust/site/:siteId ────────────────────────────────────────────

trustCenter.put(
  '/api/trust/site/:siteId',
  zValidator('json', TrustProfileUpdateSchema),
  async (c) => {
    const { siteId } = c.req.param();
    const blocked = await guard(c, siteId);
    if (blocked) return blocked;
    const orgId = c.get('orgId')!;
    // Tenant isolation: only create/update a per-site override for a site this
    // org owns — otherwise a caller could write orphan `trust_profiles` rows
    // referencing another org's site. Missing/foreign site → 404 (never leak).
    const owner = await siteOrgId(c.env, siteId);
    if (!owner || owner !== orgId) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
    }
    const update = c.req.valid('json');
    const profile = await upsertProfile(c.env, {
      orgId,
      siteId,
      update,
    });
    return c.json({ data: profile });
  },
);

// ─── GET /api/public/trust/:siteSlug ────────────────────────────────────────
// Public — no Bearer required, just respects the trust_center flag and the
// org's `published=1` state.

trustCenter.get('/api/public/trust/:siteSlug', async (c) => {
  const { siteSlug } = c.req.param();

  // The public route does not need a user session — the flag check uses
  // the site's org as scope so feature existence still cannot be probed
  // for orgs that haven't enabled it.
  const site = await dbQueryOne<{
    id: string;
    org_id: string;
    slug: string;
    business_name: string;
  }>(
    c.env.DB,
    `SELECT id, org_id, slug, business_name
       FROM sites
      WHERE slug = ? AND deleted_at IS NULL
      LIMIT 1`,
    [siteSlug],
  );
  if (!site) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }

  const flagOn = await isFlagOn(c.env, FLAG_KEY, {
    siteId: site.id,
    orgId: site.org_id,
  });
  if (!flagOn) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }

  const profile = await getEffectiveProfileForSite(c.env, site.org_id, site.id);
  if (!profile || !profile.published) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Trust profile not published' } }, 404);
  }

  const publicProfile = toPublicProfile(profile, site.slug);
  const url = new URL(c.req.url);
  const jsonLd = buildTrustJsonLd(publicProfile, {
    siteUrl: `${url.protocol}//${site.slug}.projectsites.dev`,
    businessName: site.business_name,
  });

  return c.json({ data: publicProfile, jsonld: jsonLd });
});

export { trustCenter };
