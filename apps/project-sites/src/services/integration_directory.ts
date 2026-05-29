/**
 * @module services/integration_directory
 * @description Integration Directory Generator (feature #30).
 *
 * Manages `integration_services` (seeded inventory of integrable services for
 * a site) and `integration_pages` (cross-product `/integrations/{a}/{b}`
 * pages). Real screenshots come from Cloudflare Browser Rendering REST (per
 * `~/.claude` god-tier pattern #9) and are referenced by `screenshot_r2`.
 *
 * Page content is left intentionally pending — the orchestrator agent fills
 * `content_json` per pair with setup steps, configs, and FAQs.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from './db.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  integrationRouteSlug,
  IntegrationServiceSchema,
  type IntegrationGenerateRequest,
  type IntegrationService,
} from '../../libs/features/integration_directory/feature.schemas.js';

const FLAG_KEY = 'integration_directory';

// ─── Service registry ────────────────────────────────────────────────

export async function listServices(env: Env, siteId: string): Promise<IntegrationService[]> {
  const { data } = await dbQuery<{
    slug: string;
    name: string;
    category: string | null;
    homepage_url: string | null;
    docs_url: string | null;
    config_json: string | null;
  }>(
    env.DB,
    `SELECT slug, name, category, homepage_url, docs_url, config_json
     FROM integration_services
     WHERE site_id = ? AND deleted_at IS NULL
     ORDER BY slug`,
    [siteId],
  );
  return data.map((row) => {
    const parsed = IntegrationServiceSchema.safeParse({
      slug: row.slug,
      name: row.name,
      category: row.category ?? undefined,
      homepageUrl: row.homepage_url ?? undefined,
      docsUrl: row.docs_url ?? undefined,
      configJson: row.config_json ? JSON.parse(row.config_json) : undefined,
    });
    return parsed.success
      ? parsed.data
      : { slug: row.slug, name: row.name };
  });
}

export async function seedServices(
  env: Env,
  siteId: string,
  orgId: string,
  services: IntegrationService[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const svc of services) {
    const existing = await dbQueryOne<{ id: string }>(
      env.DB,
      'SELECT id FROM integration_services WHERE site_id = ? AND slug = ? AND deleted_at IS NULL',
      [siteId, svc.slug],
    );
    if (existing) {
      await dbExecute(
        env.DB,
        `UPDATE integration_services
         SET name = ?, category = ?, homepage_url = ?, docs_url = ?,
             config_json = ?, updated_at = ?
         WHERE id = ?`,
        [
          svc.name,
          svc.category ?? null,
          svc.homepageUrl ?? null,
          svc.docsUrl ?? null,
          svc.configJson ? JSON.stringify(svc.configJson) : null,
          new Date().toISOString(),
          existing.id,
        ],
      );
      updated++;
    } else {
      await dbInsert(env.DB, 'integration_services', {
        id: crypto.randomUUID(),
        site_id: siteId,
        org_id: orgId,
        slug: svc.slug,
        name: svc.name,
        category: svc.category ?? null,
        homepage_url: svc.homepageUrl ?? null,
        docs_url: svc.docsUrl ?? null,
        config_json: svc.configJson ? JSON.stringify(svc.configJson) : null,
      });
      inserted++;
    }
  }
  return { inserted, updated };
}

// ─── Pair generation ─────────────────────────────────────────────────

export async function generatePages(
  env: Env,
  siteId: string,
  orgId: string,
  req: IntegrationGenerateRequest,
): Promise<{ inserted: number; skipped: number }> {
  const services = await listServices(env, siteId);
  if (services.length < 2) return { inserted: 0, skipped: 0 };

  const pairs: Array<[string, string]> = [];
  if (req.pairs && req.pairs.length > 0) {
    for (const [a, b] of req.pairs) {
      if (a === b) continue;
      const [first, second] = [a, b].sort();
      pairs.push([first, second]);
    }
  } else {
    for (let i = 0; i < services.length; i++) {
      for (let j = i + 1; j < services.length; j++) {
        if (pairs.length >= req.maxPairs) break;
        const [first, second] = [services[i].slug, services[j].slug].sort();
        pairs.push([first, second]);
      }
      if (pairs.length >= req.maxPairs) break;
    }
  }

  let inserted = 0;
  let skipped = 0;
  for (const [a, b] of pairs) {
    const existing = await dbQueryOne<{ id: string }>(
      env.DB,
      `SELECT id FROM integration_pages
       WHERE site_id = ? AND service_a_slug = ? AND service_b_slug = ? AND deleted_at IS NULL`,
      [siteId, a, b],
    );
    if (existing) {
      skipped++;
      continue;
    }
    await dbInsert(env.DB, 'integration_pages', {
      id: crypto.randomUUID(),
      site_id: siteId,
      org_id: orgId,
      service_a_slug: a,
      service_b_slug: b,
      route_slug: integrationRouteSlug(a, b),
      status: 'draft',
    });
    inserted++;
  }
  return { inserted, skipped };
}

// ─── Publish ─────────────────────────────────────────────────────────

export async function publishPages(
  env: Env,
  siteId: string,
  pageIds: string[],
): Promise<{ published: number; missing: number }> {
  if (!(await isFlagOn(env, FLAG_KEY))) {
    return { published: 0, missing: pageIds.length };
  }
  const site = await dbQueryOne<{ slug: string }>(
    env.DB,
    'SELECT slug FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  if (!site) return { published: 0, missing: pageIds.length };

  let published = 0;
  let missing = 0;
  for (const pageId of pageIds) {
    const row = await dbQueryOne<{
      id: string;
      route_slug: string;
      content_json: string | null;
      jsonld_json: string | null;
    }>(
      env.DB,
      `SELECT id, route_slug, content_json, jsonld_json
       FROM integration_pages
       WHERE id = ? AND site_id = ? AND deleted_at IS NULL`,
      [pageId, siteId],
    );
    if (!row) {
      missing++;
      continue;
    }
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${row.route_slug}</title>
${row.jsonld_json ? `<script type="application/ld+json">${row.jsonld_json}</script>` : ''}
</head>
<body>
${row.content_json ?? '<!-- pending content fill -->'}
</body>
</html>`;
    const r2Key = `sites/${site.slug}/latest${row.route_slug}/index.html`;
    await env.SITES_BUCKET.put(r2Key, html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
    await dbExecute(
      env.DB,
      `UPDATE integration_pages
       SET status = 'published', published_at = ?, r2_path = ?, updated_at = ?
       WHERE id = ?`,
      [new Date().toISOString(), r2Key, new Date().toISOString(), pageId],
    );
    published++;
  }
  return { published, missing };
}

export async function listPages(env: Env, siteId: string, status?: string) {
  const where = status
    ? 'WHERE site_id = ? AND status = ? AND deleted_at IS NULL'
    : 'WHERE site_id = ? AND deleted_at IS NULL';
  const params = status ? [siteId, status] : [siteId];
  const { data } = await dbQuery<{
    id: string;
    route_slug: string;
    service_a_slug: string;
    service_b_slug: string;
    status: string;
    published_at: string | null;
  }>(
    env.DB,
    `SELECT id, route_slug, service_a_slug, service_b_slug, status, published_at
     FROM integration_pages ${where}
     ORDER BY created_at DESC LIMIT 200`,
    params,
  );
  return data;
}
