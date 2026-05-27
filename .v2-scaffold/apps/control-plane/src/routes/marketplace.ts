/**
 * Section-library marketplace (backlog #34) — scaffold.
 *
 * @remarks
 *  Browse + install pipeline. Moderation, revenue-share, author payouts are
 *  deferred. Listings are gated by `status = 'published'` (admin promotes
 *  drafts via the super-admin surface — not implemented here).
 *
 *  Endpoints:
 *   - `GET /api/marketplace/sections`            — search/filter
 *   - `GET /api/marketplace/sections/:id`        — detail
 *   - `POST /api/marketplace/sections/:id/install` — copy into a tenant site
 *
 *  Install pipeline (HTML blob lives in R2):
 *   1. Verify caller's site belongs to their tenant.
 *   2. Verify section is `published`.
 *   3. Copy `marketplace/sections/{id}/blob.html` → `sites/{slug}/{ver}/sections/{slug}-{id}.html`.
 *   4. Insert `section_installs` row, increment `downloads` counter.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import { writeAudit } from '../services/audit.js';

const app = new Hono<HonoEnv>();

interface SectionRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string | null;
  preview_image_url: string | null;
  html_blob_r2_key: string;
  props_schema_json: string;
  downloads: number;
  rating: number | null;
  status: string;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── List + search ───────────────────────────────────────────────────────────
app.get(
  '/sections',
  zValidator(
    'query',
    z.object({
      q: z.string().max(120).optional(),
      category: z.string().max(64).optional(),
      sort: z.enum(['downloads', 'rating', 'recent']).default('downloads'),
      limit: z.coerce.number().int().min(1).max(100).default(40),
    }),
  ),
  async (c) => {
    requireAuth(c);
    const { q, category, sort, limit } = c.req.valid('query');
    const filters: string[] = [`status = 'published'`];
    const params: unknown[] = [];
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      filters.push(
        `(LOWER(name) LIKE ?${params.length} OR LOWER(description) LIKE ?${params.length})`,
      );
    }
    if (category) {
      params.push(category);
      filters.push(`category = ?${params.length}`);
    }
    const orderBy =
      sort === 'rating'
        ? 'COALESCE(rating, 0) DESC, downloads DESC'
        : sort === 'recent'
          ? 'created_at DESC'
          : 'downloads DESC, COALESCE(rating, 0) DESC';
    params.push(limit);
    const limitParamIndex = params.length;
    const rows = await dbQuery<SectionRow>(
      c.env.DB,
      `SELECT id, slug, name, description, category, preview_image_url,
              html_blob_r2_key, props_schema_json, downloads, rating, status,
              author_id, created_at, updated_at
         FROM marketplace_sections
        WHERE ${filters.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT ?${limitParamIndex}`,
      params,
    );
    return c.json({ sections: rows.map(toPublic) });
  },
);

// ── Detail ──────────────────────────────────────────────────────────────────
app.get('/sections/:id', async (c) => {
  requireAuth(c);
  const id = c.req.param('id');
  const row = await dbQueryOne<SectionRow>(
    c.env.DB,
    `SELECT id, slug, name, description, category, preview_image_url,
            html_blob_r2_key, props_schema_json, downloads, rating, status,
            author_id, created_at, updated_at
       FROM marketplace_sections WHERE id = ?1`,
    [id],
  );
  if (!row || row.status === 'archived') {
    throw new AppError(ErrorCode.NOT_FOUND, 'section');
  }
  return c.json(toPublic(row));
});

// ── Install ─────────────────────────────────────────────────────────────────
app.post(
  '/sections/:id/install',
  zValidator(
    'json',
    z.object({
      site_id: z.string().uuid(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = c.get('tenantId') ?? c.get('orgId');
    if (!tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'tenant required');
    const sectionId = c.req.param('id');
    const { site_id } = c.req.valid('json');

    const section = await dbQueryOne<SectionRow>(
      c.env.DB,
      `SELECT id, slug, status, html_blob_r2_key
         FROM marketplace_sections WHERE id = ?1`,
      [sectionId],
    );
    if (!section) throw new AppError(ErrorCode.NOT_FOUND, 'section');
    if (section.status !== 'published') {
      throw new AppError(ErrorCode.BAD_REQUEST, 'section is not published');
    }

    const site = await dbQueryOne<{ id: string; slug: string }>(
      c.env.DB,
      `SELECT id, slug FROM sites
        WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
      [site_id, tenantId],
    );
    if (!site) throw new AppError(ErrorCode.NOT_FOUND, 'site');

    // Copy the section blob from marketplace prefix to site prefix in R2.
    const sourceKey = section.html_blob_r2_key;
    const destKey = `sites/${site.slug}/v1/sections/${section.slug}-${section.id}.html`;
    const src = await c.env.BUCKET.get(sourceKey);
    if (!src) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        `section blob missing in R2 (${sourceKey})`,
      );
    }
    const body = await src.arrayBuffer();
    await c.env.BUCKET.put(destKey, body, {
      httpMetadata: {
        contentType: 'text/html; charset=utf-8',
        cacheControl: 'public, max-age=60, stale-while-revalidate=600',
      },
      customMetadata: {
        installed_from: section.id,
        installed_by: userId,
        installed_at: new Date().toISOString(),
      },
    });

    const installId = crypto.randomUUID();
    await dbInsert(c.env.DB, 'section_installs', {
      id: installId,
      site_id: site.id,
      section_id: section.id,
      installed_by: userId,
    });
    await dbExecute(
      c.env.DB,
      `UPDATE marketplace_sections
          SET downloads = downloads + 1,
              updated_at = ?1
        WHERE id = ?2`,
      [new Date().toISOString(), section.id],
    );

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'marketplace.section.install',
      target_type: 'marketplace_section',
      target_id: section.id,
      metadata: { site_id: site.id, dest_key: destKey },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({
      install_id: installId,
      section_id: section.id,
      site_id: site.id,
      dest_key: destKey,
    });
  },
);

function toPublic(r: SectionRow): Omit<SectionRow, 'html_blob_r2_key'> & {
  props_schema: unknown;
} {
  // Don't leak the internal R2 key to UI clients — install endpoint copies
  // server-side, the dashboard never reads the blob directly.
  let propsSchema: unknown = {};
  try {
    propsSchema = JSON.parse(r.props_schema_json);
  } catch {
    propsSchema = {};
  }
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    category: r.category,
    preview_image_url: r.preview_image_url,
    props_schema_json: r.props_schema_json,
    props_schema: propsSchema,
    downloads: r.downloads,
    rating: r.rating,
    status: r.status,
    author_id: r.author_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export default app;
