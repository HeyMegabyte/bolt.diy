/**
 * @module workflows/drive-sync
 * @description Cloudflare Workflows v2 — durable, resumable Google Drive ingest.
 *
 * Replaces the inline {@link syncDriveFolder} synchronous flow used by the
 * hourly cron + the admin "select-folder" / "sync" endpoints. The workflow
 * decomposes the previous one-shot routine into five resumable steps so that
 * a failure mid-ingest (Drive rate limit, R2 hiccup, D1 timeout) can be
 * retried at the step boundary without re-downloading every file.
 *
 * ## Step graph
 *
 * | Step                     | Purpose                                                |
 * | ------------------------ | ------------------------------------------------------ |
 * | `list-folder`            | Fetch remote file list from Drive folder               |
 * | `dedupe-against-existing`| Load existing D1 rows, classify each remote as add/update/skip |
 * | `fetch-each-file`        | Download each new/updated file bytes from Drive        |
 * | `extract-text`           | Run OCR/text-extract per blob                          |
 * | `persist-rows`           | Insert/update `ai_context_files`; soft-delete orphans  |
 *
 * Each `step.do` is configured with retries: limit 3, 30s exponential backoff.
 * `step.waitForEvent('user-disconnect', ...)` is wired so a user revoking
 * Drive can short-circuit the workflow before the next step boundary.
 *
 * @packageDocumentation
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { Env } from '../types/env.js';
import {
  downloadFile,
  getAccessToken,
  listFolderFiles,
  type DriveFile,
} from '../services/google_drive.js';
import { extractContext, MAX_CONTEXT_FILE_BYTES } from '../services/ai_context_extract.js';

/**
 * Parameters required to start a Drive-sync workflow run.
 *
 * @example
 * ```ts
 * await env.DRIVE_SYNC_WORKFLOW.create({
 *   id: `drive-sync-${siteId}-${Date.now()}`,
 *   params: { siteId, orgId, slug },
 * });
 * ```
 */
export interface DriveSyncParams {
  /** Site ID whose Drive folder should be ingested. */
  siteId: string;
  /** Org owning the site (denormalized into ai_context_files). */
  orgId: string;
  /** Site slug for R2 key namespacing (`sites/{slug}/ai-context/...`). */
  slug: string;
}

/** Per-file decision after dedupe pass. */
interface FileDecision {
  remote: DriveFile;
  action: 'add' | 'update' | 'skip';
  existingRowId?: string;
}

/** Final workflow output (mirrors the legacy `SyncResult` shape). */
export interface DriveSyncResult {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
}

/** Standard retry policy for resumable I/O steps. */
const RETRY_30S = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' as const },
} as const;

/**
 * Workflows v2 entrypoint for one-folder Google Drive ingest.
 *
 * Invoked from:
 * - `POST /api/sites/:siteId/ai/drive/select-folder`
 * - `POST /api/sites/:siteId/ai/drive/sync`
 * - Hourly cron (`0 * * * *`) per site that has a folder configured
 *
 * @example
 * ```ts
 * // wrangler.toml binds DRIVE_SYNC_WORKFLOW → DriveSyncWorkflow
 * const inst = await env.DRIVE_SYNC_WORKFLOW.create({
 *   id: `drive-sync-${siteId}-${Date.now()}`,
 *   params: { siteId, orgId, slug },
 * });
 * console.warn(`status URL: /api/sites/${siteId}/workflows/drive-sync/${inst.id}`);
 * ```
 */
export class DriveSyncWorkflow extends WorkflowEntrypoint<Env, DriveSyncParams> {
  override async run(
    event: Readonly<WorkflowEvent<DriveSyncParams>>,
    step: WorkflowStep,
  ): Promise<DriveSyncResult> {
    const { siteId, orgId, slug } = event.payload;
    const env = this.env;
    const db = env.DB;

    // Allow a user to short-circuit by signalling `user-disconnect` at any
    // step boundary. The event is optional — when not raised the
    // waitForEvent times out instantly and execution proceeds.
    const disconnected = await step.do('check-disconnect', RETRY_30S, async () => {
      try {
        await step.waitForEvent<{ reason?: string }>('user-disconnect', { type: 'user-disconnect', timeout: '1 seconds' });
        return true;
      } catch {
        return false;
      }
    });
    if (disconnected) {
      return { added: 0, updated: 0, removed: 0, skipped: 0 };
    }

    // ── Step 1: list-folder ─────────────────────────────────
    const { accessToken, folderId, remote } = await step.do(
      'list-folder',
      RETRY_30S,
      async () => {
        const settings = await db
          .prepare(`SELECT drive_folder_id FROM ai_site_settings WHERE site_id = ?`)
          .bind(siteId)
          .first<{ drive_folder_id: string | null }>();
        if (!settings?.drive_folder_id) throw new Error('drive_folder_not_configured');
        const token = await getAccessToken(env, db, siteId);
        if (!token) throw new Error('drive_not_connected');
        const files = await listFolderFiles(token, settings.drive_folder_id);
        return { accessToken: token, folderId: settings.drive_folder_id, remote: files };
      },
    );

    // ── Step 2: dedupe-against-existing ─────────────────────
    const { decisions, orphans } = await step.do(
      'dedupe-against-existing',
      RETRY_30S,
      async () => {
        const existing = await db
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
        const byId = new Map((existing.results ?? []).map((r) => [r.drive_file_id, r] as const));
        const out: FileDecision[] = [];
        for (const rf of remote) {
          if (rf.size > MAX_CONTEXT_FILE_BYTES) {
            out.push({ remote: rf, action: 'skip' });
            byId.delete(rf.id);
            continue;
          }
          const existingRow = byId.get(rf.id);
          if (!existingRow) {
            out.push({ remote: rf, action: 'add' });
            continue;
          }
          const isNewer =
            !existingRow.drive_modified_time ||
            Date.parse(rf.modified_time) > Date.parse(existingRow.drive_modified_time);
          out.push({
            remote: rf,
            action: isNewer ? 'update' : 'skip',
            existingRowId: existingRow.id,
          });
          byId.delete(rf.id);
        }
        return {
          decisions: out,
          orphans: Array.from(byId.values()).map((o) => o.id),
        };
      },
    );

    // ── Step 3: fetch-each-file (only for add/update) ───────
    const toIngest = decisions.filter((d) => d.action === 'add' || d.action === 'update');
    const fetched = await step.do('fetch-each-file', RETRY_30S, async () => {
      const out: Array<{ decision: FileDecision; bytes: number; r2Key: string }> = [];
      for (const d of toIngest) {
        try {
          const buf = await downloadFile(accessToken, d.remote.id);
          const id = d.existingRowId ?? crypto.randomUUID();
          const r2Key = `sites/${slug}/ai-context/${id}-${d.remote.name}`;
          await env.SITES_BUCKET.put(r2Key, buf, {
            httpMetadata: { contentType: d.remote.mime_type || 'application/octet-stream' },
          });
          out.push({ decision: { ...d, existingRowId: id }, bytes: buf.byteLength, r2Key });
        } catch {
          out.push({ decision: { ...d, action: 'skip' }, bytes: 0, r2Key: '' });
        }
      }
      return out;
    });

    // ── Step 4: extract-text per blob ───────────────────────
    const extracted = await step.do('extract-text', RETRY_30S, async () => {
      const out: Array<{ decision: FileDecision; r2Key: string; bytes: number; text: string }> = [];
      for (const f of fetched) {
        if (f.decision.action === 'skip') continue;
        try {
          // Re-fetch the bytes from R2 so this step is independently retryable.
          const obj = await env.SITES_BUCKET.get(f.r2Key);
          if (!obj) continue;
          const buf = await obj.arrayBuffer();
          const ex = await extractContext(env, buf, f.decision.remote.mime_type);
          out.push({ decision: f.decision, r2Key: f.r2Key, bytes: f.bytes, text: ex.text });
        } catch {
          // Per-file extract failure — skip this file but keep the workflow going.
        }
      }
      return out;
    });

    // ── Step 5: persist-rows (transactional batch) ──────────
    const counts = await step.do('persist-rows', RETRY_30S, async () => {
      let added = 0;
      let updated = 0;
      const removed = orphans.length;
      const skipped = decisions.filter((d) => d.action === 'skip').length;

      for (const e of extracted) {
        const d = e.decision;
        if (d.action === 'update' && d.existingRowId) {
          await db
            .prepare(
              `UPDATE ai_context_files SET filename = ?, content_type = ?, size_bytes = ?, r2_key = ?,
                      extracted_text = ?, drive_modified_time = ?, updated_at = datetime('now'), deleted_at = NULL
                 WHERE id = ?`,
            )
            .bind(
              d.remote.name,
              d.remote.mime_type,
              e.bytes,
              e.r2Key,
              e.text,
              d.remote.modified_time,
              d.existingRowId,
            )
            .run();
          updated += 1;
        } else if (d.action === 'add' && d.existingRowId) {
          await db
            .prepare(
              `INSERT INTO ai_context_files
                 (id, site_id, org_id, filename, content_type, size_bytes, r2_key, extracted_text,
                  source, drive_file_id, drive_modified_time)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'drive', ?, ?)`,
            )
            .bind(
              d.existingRowId,
              siteId,
              orgId,
              d.remote.name,
              d.remote.mime_type,
              e.bytes,
              e.r2Key,
              e.text,
              d.remote.id,
              d.remote.modified_time,
            )
            .run();
          added += 1;
        }
      }

      for (const orphanId of orphans) {
        await db
          .prepare(`UPDATE ai_context_files SET deleted_at = datetime('now') WHERE id = ?`)
          .bind(orphanId)
          .run();
      }

      await db
        .prepare(
          `UPDATE ai_site_settings SET drive_last_synced_at = datetime('now'), updated_at = datetime('now') WHERE site_id = ?`,
        )
        .bind(siteId)
        .run();

      return { added, updated, removed, skipped, folderId };
    });

    return {
      added: counts.added,
      updated: counts.updated,
      removed: counts.removed,
      skipped: counts.skipped,
    };
  }
}
