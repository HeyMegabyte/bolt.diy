/**
 * Site DNA Taste Graph routes (#7).
 *
 * Routes:
 *   POST /api/site-dna/:siteId/feedback     → record accept/reject/edit action
 *   GET  /api/site-dna/:siteId/preferences  → top-K accepted patterns by component class
 *   GET  /api/site-dna/:siteId/history      → recent feedback list (admin)
 *
 * Flag: `site_dna_taste_graph` (experimental, enabled=0, rollout=0).
 * Server guard: 404 when off.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import {
  recordDnaFeedback,
  getDnaPreferences,
  listDnaFeedback,
  type DnaAction,
} from '../services/site_dna.js';

const siteDna = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Flag gate helper ───────────────────────────────────────────────────────

async function assertFlagOn(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT enabled FROM feature_flags WHERE key = 'site_dna_taste_graph' LIMIT 1",
  ).first<{ enabled: number }>().catch(() => null);
  return !!row?.enabled;
}

// ── POST /api/site-dna/:siteId/feedback ──────────────────────────────────

siteDna.post('/api/site-dna/:siteId/feedback', async (c) => {
  if (!(await assertFlagOn(c.env))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'site_dna_taste_graph not enabled' } }, 404);
  }

  const siteId = c.req.param('siteId');
  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);

  const rawBody = await c.req.json<{
    component_id?: string;
    action?: string;
    context?: Record<string, unknown>;
  }>().catch(() => null);
  const body = rawBody ?? {};

  if (!body.component_id) return c.json({ error: { code: 'BAD_REQUEST', message: 'component_id required' } }, 400);
  const validActions: DnaAction[] = ['accept', 'reject', 'edit'];
  if (!body.action || !validActions.includes(body.action as DnaAction)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'action must be accept|reject|edit' } }, 400);
  }

  // Derive component_class from context or component_id prefix.
  const ctx = body.context ?? {};
  const componentClass = (ctx.component_class as string) ?? (body.component_id.split('-')[0] ?? 'generic');

  const result = await recordDnaFeedback(c.env, {
    orgId,
    siteId,
    componentId: body.component_id,
    componentClass,
    action: body.action as DnaAction,
    context: ctx,
  });

  return c.json({ ...result, site_id: siteId, component_id: body.component_id ?? '', action: body.action ?? '' }, 201);
});

// ── GET /api/site-dna/:siteId/preferences ─────────────────────────────────

siteDna.get('/api/site-dna/:siteId/preferences', async (c) => {
  if (!(await assertFlagOn(c.env))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'site_dna_taste_graph not enabled' } }, 404);
  }

  const siteId = c.req.param('siteId');
  const componentClass = c.req.query('class');
  const topK = Math.min(Number(c.req.query('top_k') ?? '10'), 50);

  const prefs = await getDnaPreferences(c.env, siteId, componentClass, topK);
  return c.json({ site_id: siteId, component_class: componentClass ?? 'all', preferences: prefs, count: prefs.length });
});

// ── GET /api/site-dna/:siteId/history ─────────────────────────────────────

siteDna.get('/api/site-dna/:siteId/history', async (c) => {
  if (!(await assertFlagOn(c.env))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'site_dna_taste_graph not enabled' } }, 404);
  }

  const siteId = c.req.param('siteId');
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const history = await listDnaFeedback(c.env, siteId, limit);
  return c.json({ site_id: siteId, history, count: history.length });
});

export { siteDna };
export default siteDna;
