/**
 * @module services/ai_drive_sync
 *
 * Idempotent Google Drive folder ingest for AI chat context. Pulls the file
 * list from a configured folder, downloads new / modified files, runs them
 * through {@link extractContext}, and persists rows in `ai_context_files`
 * with `source='drive'`. Matches existing rows by `drive_file_id`.
 */
import type { Env } from '../types/env.js';
import {
  downloadFile,
  getAccessToken,
  listFolderFiles,
  type DriveFile,
} from './google_drive.js';
import { extractContext, MAX_CONTEXT_FILE_BYTES } from './ai_context_extract.js';

/** Sync result counts. */
export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
}

/**
 * Sync the configured Drive folder for a single site. Throws when the site
 * has no folder configured or the OAuth token is missing.
 *
 * @param env    - Worker env.
 * @param db     - D1 binding.
 * @param siteId - Site ID to sync.
 * @param orgId  - Org ID (denormalized into the ai_context_files row).
 * @param slug   - Site slug (used for R2 key namespacing).
 * @returns Sync counts.
 */
export async function syncDriveFolder(
  env: Env,
  db: D1Database,
  siteId: string,
  orgId: string,
  slug: string,
): Promise<SyncResult> {
  const settings = await db
    .prepare(`SELECT drive_folder_id FROM ai_site_settings WHERE site_id = ?`)
    .bind(siteId)
    .first<{ drive_folder_id: string | null }>();
  if (!settings?.drive_folder_id) {
    throw new Error('drive_folder_not_configured');
  }
  const accessToken = await getAccessToken(env, db, siteId);
  if (!accessToken) throw new Error('drive_not_connected');

  const remote = await listFolderFiles(accessToken, settings.drive_folder_id);

  const existingRows = await db
    .prepare(
      `SELECT id, drive_file_id, drive_modified_time, r2_key FROM ai_context_files
       WHERE site_id = ? AND source = 'drive' AND deleted_at IS NULL`,
    )
    .bind(siteId)
    .all<{
      id: string;
      drive_file_id: string;
      drive_modified_time: string | null;
      r2_key: string;
    }>();
  const existingByDriveId = new Map(
    (existingRows.results ?? []).map((r) => [r.drive_file_id, r] as const),
  );

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const remoteFile of remote) {
    if (remoteFile.size > MAX_CONTEXT_FILE_BYTES) {
      skipped += 1;
      continue;
    }
    const existing = existingByDriveId.get(remoteFile.id);
    const isNew = !existing;
    const isUpdated =
      existing &&
      (!existing.drive_modified_time ||
        Date.parse(remoteFile.modified_time) > Date.parse(existing.drive_modified_time));
    if (!isNew && !isUpdated) {
      skipped += 1;
      existingByDriveId.delete(remoteFile.id); // mark as seen
      continue;
    }
    try {
      await ingestDriveFile(env, db, siteId, orgId, slug, remoteFile, accessToken, existing?.id);
      if (isNew) added += 1;
      else updated += 1;
    } catch {
      skipped += 1;
    }
    existingByDriveId.delete(remoteFile.id);
  }

  // Anything left in existingByDriveId was removed remotely → soft-delete.
  let removed = 0;
  for (const orphan of existingByDriveId.values()) {
    await db
      .prepare(
        `UPDATE ai_context_files SET deleted_at = datetime('now') WHERE id = ?`,
      )
      .bind(orphan.id)
      .run();
    removed += 1;
  }

  await db
    .prepare(
      `UPDATE ai_site_settings SET drive_last_synced_at = datetime('now'), updated_at = datetime('now') WHERE site_id = ?`,
    )
    .bind(siteId)
    .run();

  return { added, updated, removed, skipped };
}

/**
 * Internal: download + extract + upsert a single Drive file into R2 + D1.
 */
async function ingestDriveFile(
  env: Env,
  db: D1Database,
  siteId: string,
  orgId: string,
  slug: string,
  remote: DriveFile,
  accessToken: string,
  existingRowId: string | undefined,
): Promise<void> {
  const buf = await downloadFile(accessToken, remote.id);
  const id = existingRowId ?? crypto.randomUUID();
  const r2Key = `sites/${slug}/ai-context/${id}-${remote.name}`;
  await env.SITES_BUCKET.put(r2Key, buf, {
    httpMetadata: { contentType: remote.mime_type || 'application/octet-stream' },
  });
  const extraction = await extractContext(env, buf, remote.mime_type);
  if (existingRowId) {
    await db
      .prepare(
        `UPDATE ai_context_files SET filename = ?, content_type = ?, size_bytes = ?, r2_key = ?,
              extracted_text = ?, drive_modified_time = ?, updated_at = datetime('now'), deleted_at = NULL
         WHERE id = ?`,
      )
      .bind(
        remote.name,
        remote.mime_type,
        buf.byteLength,
        r2Key,
        extraction.text,
        remote.modified_time,
        existingRowId,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO ai_context_files
           (id, site_id, org_id, filename, content_type, size_bytes, r2_key, extracted_text,
            source, drive_file_id, drive_modified_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'drive', ?, ?)`,
      )
      .bind(
        id,
        siteId,
        orgId,
        remote.name,
        remote.mime_type,
        buf.byteLength,
        r2Key,
        extraction.text,
        remote.id,
        remote.modified_time,
      )
      .run();
  }
}

/**
 * Walk every site that has a Drive folder configured and sync each.
 * Soft-fails per site — one site's failure must not block others.
 *
 * @param env - Worker env.
 * @param db  - D1 binding.
 * @returns Per-site outcome map for observability logging.
 */
export async function syncAllSites(
  env: Env,
  db: D1Database,
): Promise<Array<{ site_id: string; ok: boolean; error?: string; result?: SyncResult }>> {
  const rows = await db
    .prepare(
      `SELECT s.id AS site_id, s.org_id, s.slug
       FROM sites s
       INNER JOIN ai_site_settings a ON a.site_id = s.id
       WHERE a.drive_folder_id IS NOT NULL AND s.deleted_at IS NULL`,
    )
    .all<{ site_id: string; org_id: string; slug: string }>();
  const out: Array<{ site_id: string; ok: boolean; error?: string; result?: SyncResult }> = [];
  for (const r of rows.results ?? []) {
    try {
      const result = await syncDriveFolder(env, db, r.site_id, r.org_id, r.slug);
      out.push({ site_id: r.site_id, ok: true, result });
    } catch (e) {
      out.push({ site_id: r.site_id, ok: false, error: e instanceof Error ? e.message : 'unknown' });
    }
  }
  return out;
}
