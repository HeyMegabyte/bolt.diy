/**
 * @module libs/features/ai_context/handlers
 *
 * @description
 * Hono routes for a site's **AI context / knowledge management** — the files
 * (uploads + Google-Drive ingests) that feed the site's AI-chat knowledge base,
 * plus the Google-Drive OAuth + folder-sync surface that pulls them in. Two
 * distinct file stores are managed here: the legacy `ai_chat_context_files`
 * table (`/ai-chat/context-files*`, text-only extraction, 5 MB cap) and the
 * newer `ai_context_files` table (`/ai/context/*`, PDF/image Vision extraction,
 * 10 MB cap, drive-sourced rows). Every route requires both an `orgId` and a
 * `userId` on the request context — the {@link need} helper throws
 * `HTTPError(401)` when either is missing — and guards site ownership through
 * {@link siteOwned} (404, never 403, on a missing/foreign site so cross-org
 * sites never leak).
 *
 * | Method | Path                                                    | Auth         | Purpose                                                    |
 * | ------ | ------------------------------------------------------- | ------------ | --------------------------------------------------------- |
 * | GET    | /api/sites/:siteId/ai-chat/context-files                | orgId+userId | List legacy AI-chat context files (metadata only)         |
 * | POST   | /api/sites/:siteId/ai-chat/context-files                | orgId+userId | Upload a legacy context file (multipart, 5 MB, text)      |
 * | DELETE | /api/sites/:siteId/ai-chat/context-files/:fileId        | orgId+userId | Remove a legacy context file (R2 + D1)                    |
 * | POST   | /api/sites/:siteId/ai/context/upload                    | orgId+userId | Upload a PDF/image (multipart, 10 MB, Vision-extract)     |
 * | GET    | /api/sites/:siteId/ai/context/files                     | orgId+userId | List context files (uploads + drive ingests)             |
 * | DELETE | /api/sites/:siteId/ai/context/files/:fileId             | orgId+userId | Soft-delete a context file (R2 best-effort)              |
 * | GET    | /api/sites/:siteId/ai/drive/auth-url                    | orgId+userId | Build the Google Drive OAuth consent URL                 |
 * | POST   | /api/sites/:siteId/ai/drive/folders                     | orgId+userId | List readable Drive folders (optional name filter)       |
 * | POST   | /api/sites/:siteId/ai/drive/select-folder               | orgId+userId | Persist chosen folder + trigger an immediate sync        |
 * | POST   | /api/sites/:siteId/ai/drive/sync                        | orgId+userId | Re-pull the configured folder (Workflow or inline)       |
 * | GET    | /api/sites/:siteId/ai/context/summary                   | orgId+userId | Markdown digest of every AI-chat input (60s KV cache)    |
 *
 * Extracted VERBATIM from the `ai_admin.ts` monolith (route-decomposition
 * installment 16) — only the route-registration receiver changed (`aiAdmin.` →
 * `aiContext.`); the handler bodies (and the local `driveCallbackUrl` /
 * `triggerDriveSync` / `renderContextMarkdown` helpers) are byte-for-byte
 * unchanged. The module reproduces ai_admin's EXACT error scaffolding (the
 * `HTTPError` class, the `need(c)` / `siteOwned(...)` / `safeJson(...)` helpers,
 * and a byte-identical `onError`) so behavior is identical: it contains ONLY
 * these ai_admin-sourced routes, so exact reproduction = byte-identical behavior
 * (no re-throw needed — this module has no pre-existing shared-`AppError` routes
 * to fall through to). Bodies are read via a raw `as {…}` cast +
 * `.catch(() => ({}))` rather than a Zod schema at the boundary, so there is no
 * `schemas.ts` — the moved handlers keep their original in-body validation.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import {
  HTTPError,
  need,
  siteOwned,
  aiAdminOnError,
  type Ctx,
} from '../../../src/lib/ai_admin_kit.js';
import {
  extractContext,
  MAX_CONTEXT_FILE_BYTES,
} from '../../../src/services/ai_context_extract.js';
import {
  buildAuthUrl,
  getAccessToken,
  listFolders,
  DRIVE_SCOPE,
} from '../../../src/services/google_drive.js';
import { syncDriveFolder } from '../../../src/services/ai_drive_sync.js';
import { safeParseJSONOrNull } from '../../../src/utils/safe-parse.js';
import * as auditService from '../../../src/services/audit.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const aiContext = new Hono<AppContext>();

// Error/auth scaffolding (HTTPError · need · siteOwned · safeJson · onError) is
// shared via src/lib/ai_admin_kit.ts — imported above (route-decomposition
// installment 17, DRY consolidation). Byte-identical behavior to the prior
// inline copies; see the kit module doc for the siteOwned-vs-requireOwnedSite
// rationale.
aiContext.onError(aiAdminOnError);

/* ────────────────────────── AI Chat Context Files ────────────────────────── */

/**
 * `GET /api/sites/:siteId/ai-chat/context-files` — List uploaded context
 * files indexed into the site's AI chat knowledge base.
 *
 * @remarks
 * Returns file metadata + `text_chars` (extracted text length) but never
 * the file body itself. Order is most-recent first.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 */
aiContext.get('/api/sites/:siteId/ai-chat/context-files', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, filename, mime_type, size_bytes, description, enabled,
            length(extracted_text) AS text_chars, created_at
     FROM ai_chat_context_files WHERE site_id = ? ORDER BY created_at DESC`,
  )
    .bind(siteId)
    .all();
  return c.json({ data: rows.results ?? [] });
});

/**
 * `POST /api/sites/:siteId/ai-chat/context-files` — Upload a context file
 * (multipart/form-data) for the site's AI chat knowledge base.
 *
 * @remarks
 * Body must be `multipart/form-data` with a `file` field (max 5 MB) and
 * optional `description`. The file body lands in R2 at
 * `ai-context/{siteId}/{id}-{filename}`; text files are also extracted
 * inline up to 60k chars for prompt embedding. Writes an audit-log entry
 * on success.
 *
 * Response: `{ data: { id, filename, size_bytes, indexed } }` (HTTP 201)
 *
 * @throws 400 BAD_REQUEST when content-type isn't multipart, when no file
 *   field is provided, or when the file exceeds 5 MB.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 */
aiContext.post('/api/sites/:siteId/ai-chat/context-files', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const ct = c.req.header('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) throw new HTTPError(400, 'multipart/form-data required');
  const form = await c.req.formData();
  const fileRaw = form.get('file');
  if (!fileRaw || typeof fileRaw === 'string') throw new HTTPError(400, 'file field required');
  const file = fileRaw as unknown as File;
  if (file.size > 5 * 1024 * 1024) throw new HTTPError(400, 'file too large (max 5 MB)');
  const description = (form.get('description') as string | null) ?? null;
  const id = crypto.randomUUID();
  const r2Key = `ai-context/${siteId}/${id}-${file.name}`;
  const buf = await file.arrayBuffer();
  await c.env.SITES_BUCKET.put(r2Key, buf, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  let extracted: string | null = null;
  if (
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    file.type === 'text/markdown'
  ) {
    extracted = new TextDecoder().decode(buf).slice(0, 60_000);
  }
  await c.env.DB.prepare(
    `INSERT INTO ai_chat_context_files (id, org_id, site_id, filename, mime_type, size_bytes, r2_key, extracted_text, description, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  )
    .bind(id, orgId, siteId, file.name, file.type || null, file.size, r2Key, extracted, description)
    .run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'ai_chat.context_file_uploaded',
      message: `AI chat context file '${file.name}' uploaded to site '${siteId}' (${Math.round(file.size / 1024)} KB)`,
      target_type: 'ai_chat_context_file',
      target_id: id,
      metadata_json: {
        site_id: siteId,
        filename: file.name,
        size_bytes: file.size,
        indexed: !!extracted,
      },
      request_id: c.get('requestId'),
    }),
  );

  return c.json(
    { data: { id, filename: file.name, size_bytes: file.size, indexed: !!extracted } },
    201,
  );
});

/**
 * `DELETE /api/sites/:siteId/ai-chat/context-files/:fileId` — Remove a
 * context file from the AI chat knowledge base.
 *
 * @remarks
 * Best-effort deletes the R2 object then the D1 row, and writes an audit
 * entry. R2 failures are swallowed so an orphaned object never blocks the
 * D1 cleanup.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 * @throws 404 NOT_FOUND when the file id doesn't exist on that site.
 */
aiContext.delete('/api/sites/:siteId/ai-chat/context-files/:fileId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const fileId = c.req.param('fileId');
  const row = await c.env.DB.prepare(
    `SELECT r2_key, filename FROM ai_chat_context_files WHERE id = ? AND site_id = ?`,
  )
    .bind(fileId, siteId)
    .first<{ r2_key: string; filename: string }>();
  if (!row) throw new HTTPError(404, 'File not found');
  await c.env.SITES_BUCKET.delete(row.r2_key).catch(() => {});
  await c.env.DB.prepare(`DELETE FROM ai_chat_context_files WHERE id = ?`).bind(fileId).run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'ai_chat.context_file_deleted',
      message: `AI chat context file '${row.filename}' removed from site '${siteId}'`,
      target_type: 'ai_chat_context_file',
      target_id: fileId,
      metadata_json: { site_id: siteId, filename: row.filename },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({ data: { deleted: true } });
});

/* ────────────────────────── AI Chat Extras: uploads + drive + summary ────────────────────────── */

/**
 * Resolve the absolute callback URL for the Google Drive OAuth flow.
 * Mirrors the host the current request was served from so localhost dev
 * and production both work without env-side configuration.
 */
function driveCallbackUrl(c: Ctx): string {
  const u = new URL(c.req.url);
  return `${u.protocol}//${u.host}/api/auth/google-drive/callback`;
}

/**
 * POST /api/sites/:siteId/ai/context/upload
 * Multipart upload of a PDF or image. Stores the raw bytes in R2 and the
 * Vision-extracted text in D1. Caps file size at 10 MB.
 */
aiContext.post('/api/sites/:siteId/ai/context/upload', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const ct = c.req.header('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    throw new HTTPError(400, 'multipart/form-data required');
  }
  const form = await c.req.formData();
  const fileRaw = form.get('file');
  if (!fileRaw || typeof fileRaw === 'string') {
    throw new HTTPError(400, 'file field required');
  }
  const file = fileRaw as unknown as File;
  if (file.size > MAX_CONTEXT_FILE_BYTES) {
    return c.json({ error: { message: 'file too large (max 10 MB)' } }, 413);
  }
  const mime = file.type || 'application/octet-stream';
  if (!(mime === 'application/pdf' || mime.startsWith('image/'))) {
    throw new HTTPError(400, 'only application/pdf and image/* accepted');
  }
  const buf = await file.arrayBuffer();
  const id = crypto.randomUUID();
  const r2Key = `sites/${site.slug}/ai-context/${id}-${file.name}`;
  await c.env.SITES_BUCKET.put(r2Key, buf, { httpMetadata: { contentType: mime } });
  const extraction = await extractContext(c.env, buf, mime);
  await c.env.DB.prepare(
    `INSERT INTO ai_context_files
       (id, site_id, org_id, filename, content_type, size_bytes, r2_key, extracted_text, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'upload')`,
  )
    .bind(id, siteId, orgId, file.name, mime, file.size, r2Key, extraction.text)
    .run();
  return c.json(
    {
      data: {
        id,
        filename: file.name,
        size_bytes: file.size,
        extracted_chars: extraction.text.length,
      },
    },
    201,
  );
});

/**
 * GET /api/sites/:siteId/ai/context/files
 * List non-deleted context files (uploads + drive ingests) for the site.
 */
aiContext.get('/api/sites/:siteId/ai/context/files', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, filename, content_type, size_bytes, source, drive_file_id,
            length(extracted_text) AS extracted_chars, created_at, updated_at
     FROM ai_context_files
     WHERE site_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC`,
  )
    .bind(siteId)
    .all();
  return c.json({ data: rows.results ?? [] });
});

/**
 * DELETE /api/sites/:siteId/ai/context/files/:fileId
 * Soft-deletes the row and best-effort removes the R2 object.
 */
aiContext.delete('/api/sites/:siteId/ai/context/files/:fileId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const row = await c.env.DB.prepare(
    `SELECT r2_key FROM ai_context_files WHERE id = ? AND site_id = ? AND deleted_at IS NULL`,
  )
    .bind(c.req.param('fileId'), siteId)
    .first<{ r2_key: string }>();
  if (!row) throw new HTTPError(404, 'File not found');
  await c.env.SITES_BUCKET.delete(row.r2_key).catch(() => {});
  await c.env.DB.prepare(`UPDATE ai_context_files SET deleted_at = datetime('now') WHERE id = ?`)
    .bind(c.req.param('fileId'))
    .run();
  return c.json({ data: { deleted: true } });
});

/**
 * GET /api/sites/:siteId/ai/drive/auth-url
 * Returns the Google OAuth consent URL plus the CSRF state cookie value the
 * front-end should navigate to.  Persists state in google_drive_oauth_states.
 */
aiContext.get('/api/sites/:siteId/ai/drive/auth-url', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const redirectUrl = c.req.query('redirect_url') ?? '/admin/settings?tab=ai-chat';
  const state = crypto.randomUUID();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO google_drive_oauth_states (id, site_id, org_id, state, redirect_url, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+1 hour'))`,
  )
    .bind(id, siteId, orgId, state, redirectUrl)
    .run();
  const url = buildAuthUrl(c.env, state, driveCallbackUrl(c));
  return c.json({ data: { auth_url: url, scope: DRIVE_SCOPE } });
});

/**
 * POST /api/sites/:siteId/ai/drive/folders
 * Lists folders the connected Drive account can read. Optional body
 * `{ query }` substring-matches folder names.
 */
aiContext.post('/api/sites/:siteId/ai/drive/folders', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const body = (await c.req.json().catch(() => ({}))) as { query?: string };
  const token = await getAccessToken(c.env, c.env.DB, siteId);
  if (!token) throw new HTTPError(400, 'Drive not connected');
  const folders = await listFolders(token, body.query);
  return c.json({ data: folders });
});

/**
 * POST /api/sites/:siteId/ai/drive/select-folder
 * Persists the chosen folder on ai_site_settings and triggers an immediate
 * ingest of every eligible file in that folder.
 */
aiContext.post('/api/sites/:siteId/ai/drive/select-folder', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const body = (await c.req.json().catch(() => ({}))) as {
    folder_id?: string;
    folder_name?: string;
  };
  if (!body.folder_id || !body.folder_name) {
    throw new HTTPError(400, 'folder_id and folder_name required');
  }
  const existing = await c.env.DB.prepare(`SELECT 1 FROM ai_site_settings WHERE site_id = ?`)
    .bind(siteId)
    .first();
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE ai_site_settings SET drive_folder_id = ?, drive_folder_name = ?, updated_at = datetime('now') WHERE site_id = ?`,
    )
      .bind(body.folder_id, body.folder_name, siteId)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO ai_site_settings (site_id, drive_folder_id, drive_folder_name) VALUES (?, ?, ?)`,
    )
      .bind(siteId, body.folder_id, body.folder_name)
      .run();
  }
  return c.json({ data: await triggerDriveSync(c, siteId, orgId, site.slug) });
});

/**
 * POST /api/sites/:siteId/ai/drive/sync
 * Re-pull the configured folder. Idempotent — matches by drive_file_id and
 * skips files whose modified_time is older than the local copy.
 *
 * Workflows v2 path (item #60): when the `DRIVE_SYNC_WORKFLOW` binding is
 * present, this endpoint creates a Workflow instance and returns a
 * status URL. When absent (dev), it falls back to the legacy synchronous
 * inline `syncDriveFolder` call.
 */
aiContext.post('/api/sites/:siteId/ai/drive/sync', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  return c.json({ data: await triggerDriveSync(c, siteId, orgId, site.slug) });
});

/**
 * Internal helper: fire the drive-sync workflow when bound, otherwise run
 * the legacy inline path so dev (`wrangler dev --local`) still works.
 *
 * @returns Either `{ workflow_id, status_url }` (workflow path) or the raw
 *          `SyncResult` shape (legacy inline path).
 */
async function triggerDriveSync(
  c: Ctx,
  siteId: string,
  orgId: string,
  slug: string,
): Promise<
  | { workflow_id: string; status_url: string; mode: 'workflow' }
  | { added: number; updated: number; removed: number; skipped: number; mode: 'inline' }
> {
  if (c.env.DRIVE_SYNC_WORKFLOW) {
    const instanceId = `drive-sync-${siteId}-${Date.now()}`;
    const inst = await c.env.DRIVE_SYNC_WORKFLOW.create({
      id: instanceId,
      params: { siteId, orgId, slug },
    });
    return {
      workflow_id: inst.id,
      status_url: `/api/sites/${siteId}/workflows/drive-sync/${inst.id}`,
      mode: 'workflow',
    };
  }
  const result = await syncDriveFolder(c.env, c.env.DB, siteId, orgId, slug);
  return { ...result, mode: 'inline' };
}

/**
 * GET /api/sites/:siteId/ai/context/summary
 * Assembles a human-readable Markdown summary of every input the AI chat
 * uses: system prompt, web-research toggle, drive connection + folder, and
 * a per-file digest (filename, char count, first 300 chars). Cached 60s.
 */
aiContext.get('/api/sites/:siteId/ai/context/summary', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const cacheKey = `ai-context-summary:${siteId}`;
  const cached = await c.env.CACHE_KV.get(cacheKey);
  if (cached) {
    // KV value is set by us, but a stale / partially-written entry must not
    // 500 the request — fall through to a fresh build on parse failure.
    const hit = safeParseJSONOrNull<{ data: unknown }>(cached);
    if (hit) return c.json(hit);
  }
  const settings = await c.env.DB.prepare(
    `SELECT chat_system_prompt, allow_web_research, drive_folder_id, drive_folder_name,
            drive_last_synced_at
     FROM ai_site_settings WHERE site_id = ?`,
  )
    .bind(siteId)
    .first<{
      chat_system_prompt: string | null;
      allow_web_research: number | null;
      drive_folder_id: string | null;
      drive_folder_name: string | null;
      drive_last_synced_at: string | null;
    }>();
  const files = await c.env.DB.prepare(
    `SELECT filename, source, content_type, size_bytes,
            length(extracted_text) AS chars, substr(extracted_text, 1, 300) AS preview
     FROM ai_context_files
     WHERE site_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC`,
  )
    .bind(siteId)
    .all<{
      filename: string;
      source: string;
      content_type: string | null;
      size_bytes: number;
      chars: number | null;
      preview: string | null;
    }>();
  const fileRows = files.results ?? [];
  const totalChars = fileRows.reduce((sum, f) => sum + (f.chars ?? 0), 0);
  const md = renderContextMarkdown({
    siteName: site.business_name ?? site.slug,
    systemPrompt: settings?.chat_system_prompt ?? null,
    allowWebResearch: !!settings?.allow_web_research,
    driveFolderName: settings?.drive_folder_name ?? null,
    driveLastSyncedAt: settings?.drive_last_synced_at ?? null,
    files: fileRows,
  });
  const payload = {
    data: { markdown: md, total_chars: totalChars, file_count: fileRows.length },
  };
  await c.env.CACHE_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 60 });
  return c.json(payload);
});

/**
 * Render the markdown summary returned by /ai/context/summary.
 *
 * @param input - Pre-collected context for the chat assistant.
 * @returns Markdown string suitable for display in the admin modal.
 */
function renderContextMarkdown(input: {
  siteName: string;
  systemPrompt: string | null;
  allowWebResearch: boolean;
  driveFolderName: string | null;
  driveLastSyncedAt: string | null;
  files: Array<{
    filename: string;
    source: string;
    content_type: string | null;
    size_bytes: number;
    chars: number | null;
    preview: string | null;
  }>;
}): string {
  const lines: string[] = [];
  lines.push(`# AI Chat context — ${input.siteName}`);
  lines.push('');
  lines.push('## System prompt');
  lines.push('');
  lines.push(
    input.systemPrompt ? '```\n' + input.systemPrompt + '\n```' : '_Using platform default._',
  );
  lines.push('');
  lines.push('## Web research');
  lines.push('');
  lines.push(input.allowWebResearch ? 'Enabled — the assistant may search the web.' : 'Disabled.');
  lines.push('');
  lines.push('## Google Drive');
  lines.push('');
  if (input.driveFolderName) {
    lines.push(`Connected folder: **${input.driveFolderName}**`);
    lines.push(`Last synced: ${input.driveLastSyncedAt ?? 'never'}`);
  } else {
    lines.push('_Not connected._');
  }
  lines.push('');
  lines.push(`## Knowledge files (${input.files.length})`);
  lines.push('');
  if (!input.files.length) {
    lines.push('_No files uploaded yet._');
  } else {
    for (const f of input.files) {
      lines.push(`### ${f.filename}`);
      lines.push('');
      lines.push(
        `- Source: ${f.source} · Type: ${f.content_type ?? 'unknown'} · ${f.size_bytes} bytes · ${
          f.chars ?? 0
        } extracted chars`,
      );
      if (f.preview && f.preview.length > 0) {
        lines.push('');
        lines.push('```');
        lines.push(f.preview.replace(/```/g, '` ``'));
        lines.push('```');
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
