/**
 * @module services/pseo_matrix_v2
 * @description pSEO Matrix v2 — user-task-keyed, real-data-floor enforced.
 *
 * Unlike v1 (`pseo_matrix.ts`, service x city x intent x season keyword surface),
 * v2 takes an arbitrary set of axes (`user_task`, `city`, `service_offering`,
 * etc.) and only publishes pages whose `unique_data_pct >= 40` — i.e. enough
 * of the page body is sourced from live Google Places / real reviews / real
 * pricing data, not keyword permutation.
 *
 * The 40% floor is the post-March-2026 helpful-content compliance gate.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from './db.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  axisComboHash,
  comboToSlug,
  computeUniqueDataPct,
  DataSourcesSchema,
  PseoAxisSchema,
  PseoGenerateRequestSchema,
  UNIQUE_DATA_FLOOR_PCT,
  type DataSources,
  type PseoAxis,
  type PseoGenerateRequest,
} from '../../libs/features/pseo_matrix/feature.schemas.js';

const FLAG_KEY = 'pseo_matrix_v2';

// ─── Tenant ownership ────────────────────────────────────────────────

/**
 * Resolve the owning org of a site, for multi-tenant isolation checks.
 *
 * @remarks Defensive read — a missing/soft-deleted site returns `undefined`
 * (handlers map that to a 404, never a throw). Every `:id` (siteId) route
 * compares the result to the caller's `orgId` so a caller can't read another
 * org's pSEO axes/pages, or generate/publish onto a site they don't own, by
 * guessing a `siteId`.
 * @param env    - Worker env (D1 binding).
 * @param siteId - The site whose owner is being resolved.
 * @returns The owning `org_id`, or `undefined` when the site does not exist.
 * @example
 * ```ts
 * const owner = await siteOrgId(env, siteId);
 * if (!owner || owner !== orgId) return notFound;
 * ```
 */
export async function siteOrgId(env: Env, siteId: string): Promise<string | undefined> {
  const row = await dbQueryOne<{ org_id: string }>(
    env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  return row?.org_id ?? undefined;
}

// ─── Axes CRUD ───────────────────────────────────────────────────────

export async function listAxes(env: Env, siteId: string): Promise<PseoAxis[]> {
  const { data } = await dbQuery<{ axis_name: string; values_json: string; cap: number }>(
    env.DB,
    'SELECT axis_name, values_json, cap FROM pseo_axes WHERE site_id = ? AND deleted_at IS NULL ORDER BY axis_name',
    [siteId],
  );
  const out: PseoAxis[] = [];
  for (const row of data) {
    try {
      const values = JSON.parse(row.values_json) as string[];
      const parsed = PseoAxisSchema.safeParse({ axisName: row.axis_name, values, cap: row.cap });
      if (parsed.success) out.push(parsed.data);
    } catch {
      // skip malformed
    }
  }
  return out;
}

export async function saveAxis(
  env: Env,
  siteId: string,
  orgId: string,
  axis: PseoAxis,
): Promise<void> {
  const id = crypto.randomUUID();
  // upsert pattern: delete-then-insert under unique partial index
  await dbExecute(
    env.DB,
    'UPDATE pseo_axes SET deleted_at = ? WHERE site_id = ? AND axis_name = ? AND deleted_at IS NULL',
    [new Date().toISOString(), siteId, axis.axisName],
  );
  await dbInsert(env.DB, 'pseo_axes', {
    id,
    site_id: siteId,
    org_id: orgId,
    axis_name: axis.axisName,
    values_json: JSON.stringify(axis.values),
    cap: axis.cap,
  });
}

// ─── Generation ──────────────────────────────────────────────────────

interface GenerateResult {
  inserted: number;
  skipped: number;
  belowFloor: number;
}

/**
 * Generate v2 matrix pages from axes. Each page row starts at status='draft'
 * with content_json deferred to a downstream workflow (this scaffold creates
 * the page rows + slug + axis_combo hash; an orchestrator agent fills content).
 *
 * Cross-product of axes is capped at MAX_PAGES_PER_AXIS to avoid runaway.
 */
export async function generatePages(
  env: Env,
  siteId: string,
  orgId: string,
  req: PseoGenerateRequest,
): Promise<GenerateResult> {
  const parsed = PseoGenerateRequestSchema.parse(req);
  // Cartesian product, hard-capped
  const combos: Array<Record<string, string>> = [{}];
  for (const axis of parsed.axes) {
    const next: Array<Record<string, string>> = [];
    for (const existing of combos) {
      for (const value of axis.values) {
        if (next.length >= parsed.maxPages) break;
        next.push({ ...existing, [axis.axisName]: value });
      }
    }
    combos.length = 0;
    combos.push(...next);
    if (combos.length >= parsed.maxPages) break;
  }

  let inserted = 0;
  let skipped = 0;
  for (const combo of combos.slice(0, parsed.maxPages)) {
    const hash = axisComboHash(combo);
    const existing = await dbQueryOne<{ id: string }>(
      env.DB,
      'SELECT id FROM pseo_pages_v2 WHERE site_id = ? AND axis_combo_hash = ? AND deleted_at IS NULL',
      [siteId, hash],
    );
    if (existing) {
      skipped++;
      continue;
    }
    await dbInsert(env.DB, 'pseo_pages_v2', {
      id: crypto.randomUUID(),
      site_id: siteId,
      org_id: orgId,
      axis_combo_hash: hash,
      axis_combo_json: JSON.stringify(combo),
      slug: comboToSlug(combo),
      status: 'draft',
      unique_data_pct: 0,
      data_sources_json: JSON.stringify({ googlePlaces: 0, reviews: 0, pricing: 0, other: 0 }),
    });
    inserted++;
  }
  return { inserted, skipped, belowFloor: 0 };
}

// ─── Publish ─────────────────────────────────────────────────────────

interface PublishResult {
  published: number;
  belowFloor: number;
  missing: number;
}

/**
 * Publish a batch of page IDs. Each page that fails the >=40% unique-data
 * floor is flipped to status='below_floor' and skipped. Pages that pass
 * are written to R2 + flipped to status='published'.
 */
export async function publishPages(
  env: Env,
  siteId: string,
  pageIds: string[],
): Promise<PublishResult> {
  if (!(await isFlagOn(env, FLAG_KEY))) {
    // Flag-gated — silent no-op, 404 surfacing handled at the route layer.
    return { published: 0, belowFloor: 0, missing: pageIds.length };
  }

  const site = await dbQueryOne<{ slug: string }>(
    env.DB,
    'SELECT slug FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  if (!site) return { published: 0, belowFloor: 0, missing: pageIds.length };

  let published = 0;
  let belowFloor = 0;
  let missing = 0;

  for (const pageId of pageIds) {
    const row = await dbQueryOne<{
      id: string;
      slug: string;
      content_json: string | null;
      word_count: number | null;
      data_sources_json: string | null;
    }>(
      env.DB,
      `SELECT id, slug, content_json, word_count, data_sources_json
       FROM pseo_pages_v2
       WHERE id = ? AND site_id = ? AND deleted_at IS NULL`,
      [pageId, siteId],
    );
    if (!row) {
      missing++;
      continue;
    }
    const wordCount = row.word_count ?? 0;
    const sources = row.data_sources_json
      ? (DataSourcesSchema.safeParse(JSON.parse(row.data_sources_json)).data ?? {
          googlePlaces: 0,
          reviews: 0,
          pricing: 0,
          other: 0,
        })
      : { googlePlaces: 0, reviews: 0, pricing: 0, other: 0 };
    const pct = computeUniqueDataPct(sources as DataSources, wordCount);

    if (pct < UNIQUE_DATA_FLOOR_PCT) {
      await dbExecute(
        env.DB,
        'UPDATE pseo_pages_v2 SET status = ?, unique_data_pct = ?, updated_at = ? WHERE id = ?',
        ['below_floor', pct, new Date().toISOString(), pageId],
      );
      belowFloor++;
      continue;
    }

    // Wrap content_json into HTML shell and upload
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="projectsites-pseo-v2">
<title>${row.slug}</title>
</head>
<body>
${row.content_json ?? '<!-- pending content fill -->'}
</body>
</html>`;
    const r2Key = `sites/${site.slug}/latest${row.slug}/index.html`;
    await env.SITES_BUCKET.put(r2Key, html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
    await dbExecute(
      env.DB,
      `UPDATE pseo_pages_v2
       SET status = 'published', unique_data_pct = ?, published_at = ?, r2_path = ?, updated_at = ?
       WHERE id = ?`,
      [pct, new Date().toISOString(), r2Key, new Date().toISOString(), pageId],
    );
    published++;
  }
  return { published, belowFloor, missing };
}

// ─── Stats ───────────────────────────────────────────────────────────

export async function getMatrixStats(env: Env, siteId: string) {
  const totals = await dbQueryOne<{ total: number; published: number; below_floor: number }>(
    env.DB,
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
       SUM(CASE WHEN status='below_floor' THEN 1 ELSE 0 END) AS below_floor
     FROM pseo_pages_v2
     WHERE site_id = ? AND deleted_at IS NULL`,
    [siteId],
  );
  const axes = await listAxes(env, siteId);
  return {
    total: totals?.total ?? 0,
    published: totals?.published ?? 0,
    belowFloor: totals?.below_floor ?? 0,
    axes,
    floorPct: UNIQUE_DATA_FLOOR_PCT,
  };
}
