/**
 * Site Tags service — D1 CRUD for org-scoped tags + site-tag associations.
 *
 * @module libs/features/site_tags/service
 */
import type { Env } from '../../../src/types/env.js';
import { dbExecute, dbQueryOne, dbQuery, dbInsert } from '../../../src/services/db.js';
import type { CreateTagInput, UpdateTagInput, SetSiteTagsInput, TagRow, TagResponse } from './schemas.js';

/** Create a new tag for an org. Returns the created tag. */
export async function createTag(
  env: Env,
  orgId: string,
  input: CreateTagInput,
): Promise<TagResponse> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await dbExecute(
    env.DB,
    `INSERT INTO site_tags (id, org_id, name, color, emoji, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, input.name, input.color, input.emoji ?? null, now, now],
  );
  return { id, orgId, name: input.name, color: input.color, emoji: input.emoji ?? null, siteCount: 0, createdAt: now };
}

/** Update a tag's display properties. Returns the updated tag or null if not found. */
export async function updateTag(
  env: Env,
  orgId: string,
  tagId: string,
  input: UpdateTagInput,
): Promise<TagResponse | null> {
  const existing = await dbQueryOne<TagRow>(
    env.DB,
    `SELECT t.id, t.org_id, t.name, t.color, t.emoji, t.created_at,
            COUNT(st.site_id) as site_count
     FROM site_tags t
     LEFT JOIN site_tag_assignments st ON st.tag_id = t.id AND st.deleted_at IS NULL
     WHERE t.id = ? AND t.org_id = ? AND t.deleted_at IS NULL
     GROUP BY t.id`,
    [tagId, orgId],
  );
  if (!existing) return null;

  const name = input.name ?? existing.name;
  const color = input.color ?? existing.color;
  const emoji = input.emoji !== undefined ? input.emoji : existing.emoji;
  const now = new Date().toISOString();

  await dbExecute(
    env.DB,
    `UPDATE site_tags SET name = ?, color = ?, emoji = ?, updated_at = ? WHERE id = ? AND org_id = ?`,
    [name, color, emoji, now, tagId, orgId],
  );
  return { id: existing.id, orgId: existing.org_id, name, color, emoji, siteCount: Number(existing.site_count), createdAt: existing.created_at };
}

/** Delete (soft) a tag and remove all its site assignments. */
export async function deleteTag(env: Env, orgId: string, tagId: string): Promise<boolean> {
  const now = new Date().toISOString();
  await dbExecute(env.DB, `UPDATE site_tags SET deleted_at = ? WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [now, tagId, orgId]);
  await dbExecute(env.DB, `UPDATE site_tag_assignments SET deleted_at = ? WHERE tag_id = ? AND deleted_at IS NULL`, [now, tagId]);
  return true;
}

/** List all tags for an org, with site counts. */
export async function listTags(env: Env, orgId: string): Promise<TagResponse[]> {
  const rows = await dbQuery<TagRow>(
    env.DB,
    `SELECT t.id, t.org_id, t.name, t.color, t.emoji, t.created_at,
            COUNT(st.site_id) as site_count
     FROM site_tags t
     LEFT JOIN site_tag_assignments st ON st.tag_id = t.id AND st.deleted_at IS NULL
     WHERE t.org_id = ? AND t.deleted_at IS NULL
     GROUP BY t.id
     ORDER BY t.name ASC`,
    [orgId],
  );
  return (rows.data ?? []).map((r) => ({
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    color: r.color,
    emoji: r.emoji,
    siteCount: Number(r.site_count),
    createdAt: r.created_at,
  }));
}

/** Set the tags assigned to a site (replaces all existing assignments). */
export async function setSiteTags(env: Env, siteId: string, input: SetSiteTagsInput): Promise<TagResponse[]> {
  const now = new Date().toISOString();

  // Soft-delete existing assignments for this site
  await dbExecute(
    env.DB,
    `UPDATE site_tag_assignments SET deleted_at = ? WHERE site_id = ? AND deleted_at IS NULL`,
    [now, siteId],
  );

  // Insert new assignments (must also find the org_id from the site)
  const site = await dbQueryOne<{ org_id: string }>(
    env.DB,
    `SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL`,
    [siteId],
  );
  if (!site) throw new Error(`site_not_found:${siteId}`);

  for (const tagId of input.tagIds) {
    // Verify tag belongs to this org
    const tag = await dbQueryOne<{ id: string; org_id: string }>(
      env.DB,
      `SELECT id, org_id FROM site_tags WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
      [tagId, site.org_id],
    );
    if (!tag) continue; // skip tags that don't belong to this org
    await dbExecute(
      env.DB,
      `INSERT INTO site_tag_assignments (id, site_id, tag_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), siteId, tagId, now, now],
    );
  }

  return listTags(env, site.org_id);
}

/** Get the tags currently assigned to a site. */
export async function getSiteTags(env: Env, siteId: string): Promise<TagResponse[]> {
  const rows = await dbQuery<TagRow>(
    env.DB,
    `SELECT t.id, t.org_id, t.name, t.color, t.emoji, t.created_at,
            COUNT(st2.site_id) as site_count
     FROM site_tags t
     JOIN site_tag_assignments st ON st.tag_id = t.id AND st.site_id = ? AND st.deleted_at IS NULL
     LEFT JOIN site_tag_assignments st2 ON st2.tag_id = t.id AND st2.deleted_at IS NULL
     WHERE t.deleted_at IS NULL
     GROUP BY t.id
     ORDER BY t.name ASC`,
    [siteId],
  );
  return (rows.data ?? []).map((r) => ({
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    color: r.color,
    emoji: r.emoji,
    siteCount: Number(r.site_count),
    createdAt: r.created_at,
  }));
}
