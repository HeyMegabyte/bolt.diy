/**
 * @module routes/seo_autopilot
 * @description SEO/GEO Autopilot API routes — feature #23.
 *
 * Mount path: `/api/seo`
 *
 * Routes:
 *   POST /:siteId/freshen           — generate pending meta drafts for a site's routes
 *   GET  /:siteId/drafts            — list drafts for a site
 *   GET  /:siteId/drafts/:draftId   — single draft detail
 *   POST /drafts/:draftId/approve   — approve a pending draft (then applyToSite)
 *   GET  /:siteId/jsonld?route=...  — build schema.org JSON-LD for a route
 *
 * Every handler requires a session AND gates on the `seo_autopilot` feature flag;
 * when the flag is off the route returns 404 (never 403 — don't leak existence).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';
import {
  approveDraft,
  buildJsonLd,
  freshenSite,
  siteOrgId,
  type FreshenRouteInput,
} from '../services/seo_autopilot.js';
import { dbQuery, dbQueryOne } from '../services/db.js';
import {
  FreshenSiteBodySchema,
  JsonLdKindSchema,
} from '../../libs/features/seo_autopilot/feature.schemas.js';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const seoAutopilot = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * SEO Autopilot is a site-FEATURE (owner-facing, enabled per-site in
 * /admin/site-features), NOT a platform feature-flag — turning it on for a site
 * means "fully automatic". So the gate reads the per-site Features toggle (the
 * tenant `flag_overrides` row that routes/features.ts writes), not isFlagOn.
 * An unset / disabled / non-site-scoped request is OFF.
 */
async function autopilotOn(c: AppContext, siteId?: string): Promise<boolean> {
  if (!siteId) return false;
  const row = await dbQueryOne<{ value_json: string }>(
    c.env.DB,
    "SELECT value_json FROM flag_overrides WHERE scope = 'tenant' AND scope_id = ? AND flag_key = 'seo_autopilot' AND deleted_at IS NULL",
    [siteId],
  );
  if (!row) return false;
  try {
    return !!(JSON.parse(row.value_json) as { enabled?: boolean }).enabled;
  } catch {
    return false;
  }
}

/** Shared guard: require auth + the site-feature on. Returns a Response when blocked, else null. */
async function guard(c: AppContext, siteId?: string): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  if (!(await autopilotOn(c, siteId)))
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

  return null;
}

/**
 * Auth + flag gate, then assert the `:siteId` belongs to the caller's org —
 * tenant isolation. Returns a 404 `Response` on flag-off / cross-org / missing
 * site (never 403 — don't leak another org's site), else null to proceed.
 * Closes a gap where the `:siteId` routes previously trusted the URL id and
 * could read another org's SEO drafts or freshen drafts on a foreign site.
 */
async function ownedSiteGuard(c: AppContext, siteId: string): Promise<Response | null> {
  const blocked = await guard(c, siteId);
  if (blocked) return blocked;
  const owner = await siteOrgId(c.env, siteId);
  if (!owner || owner !== c.get('orgId')) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  return null;
}

// ─── Freshen a site (generate pending drafts) ─────────────────────────

seoAutopilot.post('/:siteId/freshen', async (c) => {
  const { siteId } = c.req.param();
  const blocked = await ownedSiteGuard(c, siteId);
  if (blocked) return blocked;

  let routes: FreshenRouteInput[] | undefined;
  try {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = FreshenSiteBodySchema.parse(raw ?? {});
    routes = parsed.routes;
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid request body' } }, 400);
  }

  const summary = await freshenSite(c.env, siteId, { orgId: c.get('orgId'), routes });
  return c.json({ ok: true, summary });
});

// ─── List drafts for a site ───────────────────────────────────────────

seoAutopilot.get('/:siteId/drafts', async (c) => {
  const { siteId } = c.req.param();
  const blocked = await ownedSiteGuard(c, siteId);
  if (blocked) return blocked;

  const status = c.req.query('status');
  const params: unknown[] = [siteId, c.get('orgId')];
  let sql = `SELECT id, site_id, org_id, route, title, description, answer_block, status,
            ai_model, ai_tokens, approved_by, approved_at, created_at
     FROM seo_meta_drafts
     WHERE site_id = ? AND org_id = ? AND deleted_at IS NULL`;
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC LIMIT 100';

  const { data } = await dbQuery(c.env.DB, sql, params);
  return c.json({ drafts: data });
});

// ─── Single draft ─────────────────────────────────────────────────────

seoAutopilot.get('/:siteId/drafts/:draftId', async (c) => {
  const { siteId, draftId } = c.req.param();
  const blocked = await ownedSiteGuard(c, siteId);
  if (blocked) return blocked;

  const draft = await dbQueryOne(
    c.env.DB,
    `SELECT id, site_id, org_id, route, title, description, answer_block, jsonld_json,
            status, ai_model, ai_tokens, approved_by, approved_at, created_at
     FROM seo_meta_drafts
     WHERE id = ? AND site_id = ? AND org_id = ? AND deleted_at IS NULL`,
    [draftId, siteId, c.get('orgId')],
  );
  if (!draft) return c.json({ error: { code: 'NOT_FOUND', message: 'Draft not found' } }, 404);

  return c.json({ draft });
});

// ─── Approve a draft ──────────────────────────────────────────────────

seoAutopilot.post('/drafts/:draftId/approve', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { draftId } = c.req.param();

  // Resolve the draft's owning org + site so the flag check is site-scoped AND
  // the caller can only approve drafts their org owns (tenant isolation).
  const owner = await dbQueryOne<{ site_id: string; org_id: string }>(
    c.env.DB,
    'SELECT site_id, org_id FROM seo_meta_drafts WHERE id = ? AND deleted_at IS NULL',
    [draftId],
  );
  const siteId = owner?.site_id;

  if (!(await autopilotOn(c, siteId)))
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

  // Missing draft OR a draft owned by another org → 404 (never leak existence).
  if (!owner || owner.org_id !== c.get('orgId')) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Draft not found' } }, 404);
  }

  const result = await approveDraft(c.env, draftId, userId, c.get('orgId') ?? '');
  if (!result.ok) {
    const code = result.error === 'Draft not found' ? 'NOT_FOUND' : 'BAD_REQUEST';
    const httpStatus = code === 'NOT_FOUND' ? 404 : 400;
    return c.json({ error: { code, message: result.error ?? 'Approve failed' } }, httpStatus);
  }

  return c.json({ ok: true, draftId, draft: result.draft });
});

// ─── Build JSON-LD for a route ────────────────────────────────────────

seoAutopilot.get('/:siteId/jsonld', async (c) => {
  const { siteId } = c.req.param();
  const blocked = await ownedSiteGuard(c, siteId);
  if (blocked) return blocked;

  const route = c.req.query('route');
  if (!route)
    return c.json({ error: { code: 'BAD_REQUEST', message: 'route query param required' } }, 400);

  const kindParsed = JsonLdKindSchema.safeParse(c.req.query('kind') ?? 'WebPage');
  const kind = kindParsed.success ? kindParsed.data : 'WebPage';

  // FAQPage is never fabricated here — no real Q&A passed via GET → WebPage floor.
  const jsonld = await buildJsonLd(c.env, { siteId, route, kind, faqs: [] });
  return c.json({ jsonld });
});

export { seoAutopilot };
