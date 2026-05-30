/**
 * @module libs/features/public_gallery/service
 * @description D1 + KV query layer for the Public Gallery feature module (idea #34).
 *
 * Reads opted-in published sites (`sites.gallery_opt_in = 1`) and shapes them
 * into validated {@link GalleryEntry} objects. The full unfiltered list is
 * cached in KV for 60s so the public SSR page + JSON API + sitemap never hammer
 * D1; category filtering + pagination happen in-memory off the cached set.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbUpdate } from '../../../src/services/db.js';
import { DOMAINS } from '@project-sites/shared';
import { GalleryEntrySchema, type GalleryEntry, type GalleryQuery } from './schemas.js';

/** KV key holding the cached full gallery list (JSON array of entries). */
const KV_CACHE_KEY = 'gallery:entries';
/** Cache TTL — short so opt-out propagates within a minute. */
const KV_TTL_SECONDS = 60;
/** Hard ceiling on listed sites (sitemap + thin-content guardrail). */
const MAX_ENTRIES = 1000;

/** Raw D1 row shape for an opted-in published site. */
interface GallerySiteRow {
  slug: string;
  business_name: string;
  /** JSON `parsed_output` from the `research-profile` task, when present. */
  profile_json: string | null;
  created_at: string;
}

/**
 * Pull a human category from a `research-profile` parsed_output JSON blob.
 * Tolerant of missing / malformed data — always returns a renderable label.
 *
 * @param profileJson - Raw `research_data.parsed_output` string or null.
 * @returns Title-cased category, or `'Website'` when unknown.
 */
function categoryFromProfile(profileJson: string | null): string {
  if (!profileJson) return 'Website';
  try {
    const parsed = JSON.parse(profileJson) as Record<string, unknown>;
    const raw = parsed.business_type ?? parsed.category ?? parsed.industry;
    if (typeof raw === 'string' && raw.trim()) {
      const t = raw.trim();
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
  } catch {
    // malformed JSON → fall through to default
  }
  return 'Website';
}

/**
 * Build the absolute live URL for a site from its slug.
 *
 * @param slug - Site slug.
 * @returns `https://{slug}.projectsites.dev`.
 */
function siteUrl(slug: string): string {
  return `https://${slug}.${DOMAINS.SITES_BASE}`;
}

/**
 * Probe R2 for a branded OG card and return its absolute URL when present.
 * Best-effort — any R2 error resolves to `undefined` so a card still renders.
 *
 * @param env  - Worker env (uses `env.SITES_BUCKET`).
 * @param slug - Site slug.
 * @returns Absolute OG-image URL or `undefined`.
 */
async function resolveOgImage(env: Env, slug: string): Promise<string | undefined> {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const key = `sites/${slug}/assets/og-image.${ext}`;
    const head = await env.SITES_BUCKET.head(key).catch(() => null);
    if (head) return `${siteUrl(slug)}/assets/og-image.${ext}`;
  }
  return undefined;
}

/**
 * Load the full set of gallery-eligible entries — KV cache first, D1 on miss.
 *
 * @param env - Worker env (uses `env.DB`, `env.CACHE_KV`, `env.SITES_BUCKET`).
 * @returns Validated {@link GalleryEntry} list, newest first.
 */
async function loadAllEntries(env: Env): Promise<GalleryEntry[]> {
  const cached = await env.CACHE_KV.get(KV_CACHE_KEY, 'json').catch(() => null);
  if (cached) {
    const parsed = GalleryEntrySchema.array().safeParse(cached);
    if (parsed.success) return parsed.data;
  }

  const { data, error } = await dbQuery<GallerySiteRow>(
    env.DB,
    `SELECT s.slug              AS slug,
            s.business_name     AS business_name,
            rd.parsed_output    AS profile_json,
            s.created_at        AS created_at
       FROM sites s
       LEFT JOIN research_data rd
         ON rd.site_id = s.id
        AND rd.task_name = 'research-profile'
        AND rd.deleted_at IS NULL
      WHERE s.gallery_opt_in = 1
        AND s.status = 'published'
        AND s.current_build_version IS NOT NULL
        AND s.deleted_at IS NULL
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT ?`,
    [MAX_ENTRIES],
  );
  if (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'public_gallery',
        feature_slug: 'public_gallery',
        message: 'gallery_d1_query_failed',
        error,
      }),
    );
    return [];
  }

  const entries = await Promise.all(
    data.map(async (row) => {
      const ogImage = await resolveOgImage(env, row.slug);
      return GalleryEntrySchema.parse({
        slug: row.slug,
        name: row.business_name,
        category: categoryFromProfile(row.profile_json),
        url: siteUrl(row.slug),
        ...(ogImage ? { ogImage } : {}),
        builtAt: row.created_at,
      });
    }),
  );

  await env.CACHE_KV.put(KV_CACHE_KEY, JSON.stringify(entries), {
    expirationTtl: KV_TTL_SECONDS,
  }).catch(() => {});
  return entries;
}

/**
 * List gallery entries with optional category filter + pagination.
 *
 * @param env   - Worker env.
 * @param query - Validated {@link GalleryQuery} (category / limit / offset).
 * @returns The page of entries plus the total matching count.
 */
export async function listGalleryEntries(
  env: Env,
  query: GalleryQuery,
): Promise<{ entries: GalleryEntry[]; total: number }> {
  const all = await loadAllEntries(env);
  const filtered = query.category
    ? all.filter((e) => e.category.toLowerCase() === query.category!.toLowerCase())
    : all;
  const page = filtered.slice(query.offset, query.offset + query.limit);
  return { entries: page, total: filtered.length };
}

/**
 * Toggle a site into / out of the public gallery.
 *
 * Scoped to the caller's org so one tenant can never flip another tenant's
 * site. Invalidates the KV list cache so the change shows up immediately.
 *
 * @param env    - Worker env.
 * @param orgId  - Caller's org (ownership guard).
 * @param siteId - Site to toggle.
 * @param on     - `true` to list, `false` to remove.
 * @returns `true` when a row was updated, `false` when the site is not owned / not found.
 */
export async function setOptIn(
  env: Env,
  orgId: string,
  siteId: string,
  on: boolean,
): Promise<boolean> {
  const { error, changes } = await dbUpdate(
    env.DB,
    'sites',
    { gallery_opt_in: on ? 1 : 0 },
    'id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'public_gallery',
        feature_slug: 'public_gallery',
        message: 'gallery_opt_in_update_failed',
        error,
        site_id: siteId,
      }),
    );
    return false;
  }
  if (changes > 0) {
    await env.CACHE_KV.delete(KV_CACHE_KEY).catch(() => {});
  }
  return changes > 0;
}
