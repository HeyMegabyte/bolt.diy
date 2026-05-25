/**
 * @module routes/templates
 * @description Templates marketplace — public catalog + per-site install.
 *
 * The catalog is browsable anonymously (no auth, no Pro gate) so it can
 * drive signup conversion. Installing a template into an existing site
 * requires auth + Pro for paid templates.
 *
 * | Path                                  | Auth | Purpose                                 |
 * | ------------------------------------- | ---- | --------------------------------------- |
 * | `GET  /api/templates`                 | -    | Browse catalog (filter by category)     |
 * | `GET  /api/templates/:slug`           | -    | Read full template detail               |
 * | `POST /api/sites/:siteId/install-template` | yes  | Install a template into a site     |
 * | `POST /api/templates`                 | pro  | Publish a community template (Pro+)     |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne, dbInsert } from '../services/db.js';
import { requirePro } from '../services/pro.js';
import { unauthorized, forbidden, notFound } from '@project-sites/shared';

const templates = new Hono<{ Bindings: Env; Variables: Variables }>();

templates.get('/api/templates', async (c) => {
  const category = c.req.query('category') ?? '';
  const where = ['visibility = ?', "status = 'live'", 'deleted_at IS NULL'];
  const params: unknown[] = ['public'];
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, slug, name, description, category, thumbnail_r2_key,
            preview_url, price_cents, install_count, rating_avg, rating_count
       FROM templates
       WHERE ${where.join(' AND ')}
       ORDER BY install_count DESC, name ASC
       LIMIT 200`,
    params,
  );
  return c.json({ templates: data });
});

templates.get('/api/templates/:slug', async (c) => {
  const slug = c.req.param('slug');
  const tpl = await dbQueryOne(
    c.env.DB,
    `SELECT id, slug, name, description, category, tags_json, thumbnail_r2_key,
            preview_url, price_cents, install_count, rating_avg, rating_count,
            base_files_r2_prefix
       FROM templates
       WHERE slug = ? AND deleted_at IS NULL LIMIT 1`,
    [slug],
  );
  if (!tpl) throw notFound('Template not found');
  const { data: versions } = await dbQuery(
    c.env.DB,
    `SELECT id, version, changelog, published_at, is_default
       FROM template_versions
       WHERE template_id = (SELECT id FROM templates WHERE slug = ? LIMIT 1)
       ORDER BY published_at DESC`,
    [slug],
  );
  return c.json({ template: tpl, versions });
});

const installSchema = z.object({
  template_slug: z.string().min(1),
  template_version: z.string().optional(),
});

templates.post(
  '/api/sites/:siteId/install-template',
  zValidator('json', installSchema),
  async (c) => {
    const siteId = c.req.param('siteId');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    if (!orgId || !userId) throw unauthorized();
    const body = c.req.valid('json');
    const site = await dbQueryOne<{ org_id: string }>(
      c.env.DB,
      'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [siteId],
    );
    if (!site || site.org_id !== orgId) throw forbidden('Site not accessible');
    const tpl = await dbQueryOne<{ id: string; price_cents: number }>(
      c.env.DB,
      'SELECT id, price_cents FROM templates WHERE slug = ? AND deleted_at IS NULL LIMIT 1',
      [body.template_slug],
    );
    if (!tpl) throw notFound('Template not found');
    // Paid templates require Pro — TODO: also debit wallet for price_cents.
    if (tpl.price_cents > 0) {
      const userRow = await dbQueryOne<{ is_pro: number }>(
        c.env.DB,
        'SELECT is_pro FROM users WHERE id = ?',
        [userId],
      );
      if (!userRow || userRow.is_pro !== 1) {
        return c.json(
          { error: { code: 'PRO_REQUIRED', message: 'Paid templates require Pro', upgrade_url: '/admin/billing?plan=pro' } },
          402,
        );
      }
    }
    const installId = crypto.randomUUID();
    await dbInsert(c.env.DB, 'template_installs', {
      id: installId,
      template_id: tpl.id,
      template_version_id: null,
      site_id: siteId,
      org_id: orgId,
      price_paid_cents: tpl.price_cents,
    });
    await c.env.DB.prepare('UPDATE templates SET install_count = install_count + 1 WHERE id = ?')
      .bind(tpl.id)
      .run();
    return c.json({ install_id: installId, template_id: tpl.id });
  },
);

const publishSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).min(3).max(64),
  name: z.string().min(3).max(120),
  description: z.string().max(500),
  category: z.string().min(2).max(40),
  tags: z.array(z.string().max(40)).max(12).default([]),
  base_files_r2_prefix: z.string().min(3).max(400),
  price_cents: z.number().int().min(0).max(50000).default(0),
});

templates.use('/api/templates', requirePro);
templates.post('/api/templates', zValidator('json', publishSchema), async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) throw unauthorized();
  const body = c.req.valid('json');
  const id = `tpl_${crypto.randomUUID()}`;
  await dbInsert(c.env.DB, 'templates', {
    id,
    slug: body.slug,
    name: body.name,
    description: body.description,
    category: body.category,
    tags_json: JSON.stringify(body.tags),
    author_org_id: orgId,
    base_files_r2_prefix: body.base_files_r2_prefix,
    price_cents: body.price_cents,
    visibility: 'public',
    status: 'live',
  });
  return c.json({ id, slug: body.slug }, 201);
});

export { templates };
