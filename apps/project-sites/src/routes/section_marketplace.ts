/**
 * Vertical Section Marketplace routes (#8).
 *
 * Routes:
 *   GET  /api/section-marketplace                 → catalog summary per industry
 *   GET  /api/section-marketplace/sections        → list variants (filterable by ?industry= + ?slot=)
 *   GET  /api/section-marketplace/sections/:id    → full variant detail + HTML/CSS templates
 *   POST /api/section-marketplace/sections/:id/fork → increment fork_count
 *
 * Admin:
 *   GET  /admin/marketplace → frontend route (see app.routes.ts)
 *
 * Flag: `section_marketplace` (experimental, enabled=0, rollout=0).
 * Server guard: 404 when off.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import {
  listSectionsByIndustry,
  getSectionVariant,
  forkSection,
  getMarketplaceCatalog,
} from '../services/section_marketplace.js';

const sectionMarketplace = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Flag gate helper ───────────────────────────────────────────────────────

async function assertFlagOn(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT enabled FROM feature_flags WHERE key = 'section_marketplace' LIMIT 1",
  ).first<{ enabled: number }>().catch(() => null);
  return !!row?.enabled;
}

// ── GET /api/section-marketplace ─────────────────────────────────────────

sectionMarketplace.get('/api/section-marketplace', async (c) => {
  if (!(await assertFlagOn(c.env))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'section_marketplace not enabled' } }, 404);
  }

  const industry = c.req.query('industry');

  if (industry) {
    // Shorthand: ?industry= returns the section variants directly.
    const sections = await listSectionsByIndustry(c.env, industry, undefined, 50);
    return c.json({ industry, sections, count: sections.length });
  }

  const catalog = await getMarketplaceCatalog(c.env);
  return c.json({ catalog, total_industries: catalog.length });
});

// ── GET /api/section-marketplace/sections ─────────────────────────────────

sectionMarketplace.get('/api/section-marketplace/sections', async (c) => {
  if (!(await assertFlagOn(c.env))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'section_marketplace not enabled' } }, 404);
  }

  const industry = c.req.query('industry');
  const slot = c.req.query('slot');
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);

  const sections = await listSectionsByIndustry(c.env, industry, slot, limit);
  return c.json({ sections, count: sections.length, industry: industry ?? 'all', slot: slot ?? 'all' });
});

// ── GET /api/section-marketplace/sections/:id ─────────────────────────────

sectionMarketplace.get('/api/section-marketplace/sections/:id', async (c) => {
  if (!(await assertFlagOn(c.env))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'section_marketplace not enabled' } }, 404);
  }

  const id = c.req.param('id');
  const variant = await getSectionVariant(c.env, id);
  if (!variant) return c.json({ error: { code: 'NOT_FOUND', message: 'Section variant not found' } }, 404);
  return c.json(variant);
});

// ── POST /api/section-marketplace/sections/:id/fork ───────────────────────

sectionMarketplace.post('/api/section-marketplace/sections/:id/fork', async (c) => {
  if (!(await assertFlagOn(c.env))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'section_marketplace not enabled' } }, 404);
  }

  const id = c.req.param('id');
  const result = await forkSection(c.env, id);
  return c.json(result, 200);
});

export { sectionMarketplace };
export default sectionMarketplace;
