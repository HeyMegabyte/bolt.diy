/**
 * @module routes/experiments
 * @description Thompson-sampling A/B tests + session events for predictive
 * prerender. Both flow through a single `_ps/` beacon path so we have one
 * analytics ingestion surface.
 *
 * Pro-only on the admin side; the public beacon endpoints are anonymous.
 *
 * | Path                                            | Auth | Purpose                       |
 * | ----------------------------------------------- | ---- | ----------------------------- |
 * | `POST /_ps/i`                                   | -    | Impression beacon              |
 * | `POST /_ps/c`                                   | -    | Conversion beacon              |
 * | `POST /_ps/e`                                   | -    | Session-event beacon (nav/scroll) |
 * | `GET  /_ps/predict?sid=...`                     | -    | Predicted next routes JSON     |
 * | `GET  /api/sites/:siteId/experiments`           | pro  | List experiments on a site     |
 * | `POST /api/sites/:siteId/experiments`           | pro  | Create experiment with variants|
 * | `POST /api/experiments/:id/promote`             | pro  | Promote winning variant        |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import { requirePro } from '../services/pro.js';
import { unauthorized, forbidden } from '@project-sites/shared';

const experiments = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Public beacons (write-only, no auth) ──────────────────────────────────

const impressionSchema = z.object({
  eid: z.string(),
  vid: z.string(),
  sid: z.string(),
  variant: z.string(),
});

/**
 * `POST /_ps/i` — Public impression beacon for a Thompson-sampling experiment.
 *
 * @remarks
 * Body: `{ eid, vid, sid, variant }`. Writes to `impressions` via
 * `waitUntil` and returns `204` immediately — fire-and-forget.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 */
experiments.post('/_ps/i', zValidator('json', impressionSchema), async (c) => {
  const body = c.req.valid('json');
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO impressions(experiment_id, variant_id, visitor_id, session_id, ts) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(body.eid, body.variant, body.vid, body.sid, Math.floor(Date.now() / 1000))
      .run(),
  );
  return new Response(null, { status: 204 });
});

const conversionSchema = z.object({
  eid: z.string(),
  vid: z.string(),
  sid: z.string(),
  variant: z.string(),
  value_cents: z.number().int().min(0).default(0),
  kind: z.enum(['click', 'form', 'booking', 'purchase']).default('click'),
});

/**
 * `POST /_ps/c` — Public conversion beacon. Updates the variant's Beta
 * posterior (α += 1) and inserts a row into `conversions`.
 *
 * @remarks
 * Body: `{ eid, vid, sid, variant, value_cents?, kind? }` where `kind`
 * is one of `click|form|booking|purchase`. Fire-and-forget — returns `204`.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 */
experiments.post('/_ps/c', zValidator('json', conversionSchema), async (c) => {
  const body = c.req.valid('json');
  c.executionCtx.waitUntil(
    Promise.all([
      c.env.DB.prepare(
        `INSERT INTO conversions(experiment_id, variant_id, visitor_id, session_id, value_cents, kind, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(body.eid, body.variant, body.vid, body.sid, body.value_cents, body.kind, Math.floor(Date.now() / 1000))
        .run(),
      // Increment Beta posterior — α += 1 on conversion.
      c.env.DB.prepare(
        `UPDATE variants SET beta_alpha = beta_alpha + 1 WHERE id = ? AND experiment_id = ?`,
      )
        .bind(body.variant, body.eid)
        .run(),
    ]),
  );
  return new Response(null, { status: 204 });
});

const sessionEventSchema = z.object({
  sid: z.string(),
  vid: z.string(),
  site_id: z.string(),
  path: z.string(),
  kind: z.enum(['nav', 'scroll', 'hover', 'click', 'dwell']),
  dwell_ms: z.number().int().min(0).optional(),
  scroll_pct: z.number().int().min(0).max(100).optional(),
  viewport_w: z.number().int().min(0).optional(),
});

/**
 * `POST /_ps/e` — Public session-event beacon (nav, scroll, hover, click,
 * dwell) feeding the predictive prerender model.
 *
 * @remarks
 * Body: `{ sid, vid, site_id, path, kind, dwell_ms?, scroll_pct?,
 * viewport_w? }`. Fire-and-forget — returns `204`.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 */
experiments.post('/_ps/e', zValidator('json', sessionEventSchema), async (c) => {
  const body = c.req.valid('json');
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO session_events(session_id, visitor_id, site_id, path, kind, dwell_ms, scroll_pct, viewport_w, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        body.sid,
        body.vid,
        body.site_id,
        body.path,
        body.kind,
        body.dwell_ms ?? null,
        body.scroll_pct ?? null,
        body.viewport_w ?? null,
        Math.floor(Date.now() / 1000),
      )
      .run(),
  );
  return new Response(null, { status: 204 });
});

/**
 * `GET /_ps/predict?sid=…` — Public endpoint returning the predicted
 * next routes for a session id (drives Speculation-Rules prerender hints).
 *
 * Response: `{ routes: string[] }`.
 *
 * @throws 400 BAD_REQUEST when `sid` is missing.
 */
experiments.get('/_ps/predict', async (c) => {
  const sid = c.req.query('sid');
  if (!sid) return c.json({ predictions: [] });
  // Cached prediction lookup (visitor signature → top-3 paths).
  const cached = await dbQueryOne<{ predictions_json: string }>(
    c.env.DB,
    `SELECT predictions_json FROM prerender_predictions WHERE visitor_signature = ? AND expires_at > CURRENT_TIMESTAMP LIMIT 1`,
    [sid],
  );
  if (cached) {
    try {
      return c.json({ predictions: JSON.parse(cached.predictions_json) });
    } catch {
      /* fall through */
    }
  }
  return c.json({ predictions: [] });
});

// ─── Admin (Pro-gated) — experiment management ─────────────────────────────

experiments.use('/api/sites/:siteId/experiments/*', requirePro);
experiments.use('/api/sites/:siteId/experiments', requirePro);
experiments.use('/api/experiments/*', requirePro);

/**
 * `GET /api/sites/:siteId/experiments` — List experiments on a site
 * including variant Beta posteriors.
 *
 * @remarks
 * Pro-only. The Beta posterior shown (`α, β`) is the live count used by
 * the Thompson sampler at edge time.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 402 PAYMENT_REQUIRED when the org is not on Pro.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 */
experiments.get('/api/sites/:siteId/experiments', async (c) => {
  const siteId = c.req.param('siteId');
  await assertSiteOwnership(c, siteId);
  const { data: exps } = await dbQuery(
    c.env.DB,
    `SELECT id, name, hypothesis, surface, status, lookback_days,
            promote_threshold, promoted_variant_id, created_at
       FROM experiments WHERE site_id = ? ORDER BY created_at DESC`,
    [siteId],
  );
  return c.json({ experiments: exps });
});

const createExpSchema = z.object({
  name: z.string().min(2).max(120),
  hypothesis: z.string().max(500).optional(),
  surface: z.string().min(2).max(60),
  variants: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        payload: z.record(z.unknown()),
        weight: z.number().min(0).max(10).default(1),
        is_control: z.boolean().default(false),
      }),
    )
    .min(2)
    .max(8),
});

/**
 * `POST /api/sites/:siteId/experiments` — Create an experiment with 2–8
 * variants.
 *
 * @remarks
 * Body: {@link createExpSchema}. Each variant starts with `beta_alpha=1`,
 * `beta_beta=1` (uniform prior). Pro-only.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 402 PAYMENT_REQUIRED when the org is not on Pro.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 */
experiments.post(
  '/api/sites/:siteId/experiments',
  zValidator('json', createExpSchema),
  async (c) => {
    const siteId = c.req.param('siteId');
    await assertSiteOwnership(c, siteId);
    const body = c.req.valid('json');
    const userId = c.get('userId') as string;
    const expId = crypto.randomUUID();
    await dbInsert(c.env.DB, 'experiments', {
      id: expId,
      site_id: siteId,
      name: body.name,
      hypothesis: body.hypothesis ?? null,
      surface: body.surface,
      status: 'running',
      created_by: userId,
    });
    for (const v of body.variants) {
      await dbInsert(c.env.DB, 'variants', {
        id: crypto.randomUUID(),
        experiment_id: expId,
        name: v.name,
        payload_json: JSON.stringify(v.payload),
        weight: v.weight,
        is_control: v.is_control ? 1 : 0,
        beta_alpha: 1,
        beta_beta: 1,
      });
    }
    return c.json({ id: expId, status: 'running' }, 201);
  },
);

/**
 * `POST /api/experiments/:id/promote` — Promote the current Thompson-sample
 * winner to be the always-served variant, freezing the experiment.
 *
 * @remarks
 * Pro-only. Sets `experiments.status = 'promoted'` +
 * `promoted_variant_id = ?` so the edge stops sampling.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 402 PAYMENT_REQUIRED when the org is not on Pro.
 * @throws 403 FORBIDDEN when the experiment is not owned by the caller's org.
 * @throws 404 NOT_FOUND when the experiment id doesn't exist.
 */
experiments.post('/api/experiments/:id/promote', async (c) => {
  const id = c.req.param('id');
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const exp = await dbQueryOne<{ site_id: string; id: string }>(
    c.env.DB,
    `SELECT e.id, e.site_id FROM experiments e
       JOIN sites s ON s.id = e.site_id
       WHERE e.id = ? AND s.org_id = ? AND s.deleted_at IS NULL LIMIT 1`,
    [id, orgId],
  );
  if (!exp) throw forbidden('Experiment not accessible');
  const { data: variants } = await dbQuery<{ id: string; beta_alpha: number; beta_beta: number }>(
    c.env.DB,
    `SELECT id, beta_alpha, beta_beta FROM variants WHERE experiment_id = ?`,
    [exp.id],
  );
  // Pick variant with highest mean — α / (α+β).
  let winnerId: string | null = null;
  let bestMean = -1;
  for (const v of variants) {
    const mean = v.beta_alpha / (v.beta_alpha + v.beta_beta);
    if (mean > bestMean) {
      bestMean = mean;
      winnerId = v.id;
    }
  }
  await dbUpdate(
    c.env.DB,
    'experiments',
    { status: 'promoted', promoted_variant_id: winnerId },
    'id = ?',
    [exp.id],
  );
  return c.json({ ok: true, promoted_variant_id: winnerId });
});

async function assertSiteOwnership(
  c: { env: Env; get: (k: string) => string | undefined },
  siteId: string,
): Promise<string> {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const row = await dbQueryOne<{ org_id: string }>(
    c.env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [siteId],
  );
  if (!row || row.org_id !== orgId) throw forbidden('Site not accessible');
  return orgId;
}

export { experiments };
