/**
 * @module libs/features/site_files/handlers
 *
 * @description
 * Hono routes for a site's **editor file CRUD** — the R2-backed in-app / bolt.diy
 * embedded-editor surface that lists, bulk-exports, reads, writes, and deletes the
 * individual files that make up a published site's build. Every route is org-scoped
 * via `c.get('orgId')` and guards site ownership through `requireOwnedSite` (404,
 * never 403, on a missing/foreign site so cross-org sites never leak). Per-file
 * routes additionally pass the path through `sanitizeFilePath` (traversal defense)
 * and a post-sanitize `sites/{slug}/` prefix-guard (cross-site isolation) — both
 * must pass. Files live at `sites/{slug}/[{version}/]{path}` on R2.
 *
 * | Method | Path                              | Auth  | Purpose                                                    |
 * | ------ | --------------------------------- | ----- | ---------------------------------------------------------- |
 * | GET    | /api/sites/:id/files              | orgId | List R2 keys for a site (optional `?version=`), cap 500    |
 * | GET    | /api/sites/:id/files-export       | orgId | Inline `{path: content}` map (text-only, ≤500KB/file)      |
 * | GET    | /api/sites/:id/files/:path{.+}    | orgId | Read one file's body (sanitized + prefix-guarded)          |
 * | PUT    | /api/sites/:id/files/:path{.+}    | orgId | Create/overwrite one file (Zod body, KV purge, audit)      |
 * | DELETE | /api/sites/:id/files/:path{.+}    | orgId | Hard-delete one file (KV purge, audit)                     |
 *
 * Extracted VERBATIM from the `api.ts` monolith (route-decomposition installment
 * 10) — only the route-registration receiver changed (`api.` → `siteFiles.`); the
 * handler bodies are byte-for-byte unchanged. The private `sanitizeFilePath`
 * traversal-defense helper moved alongside its only callers (the three per-file
 * routes), as did the `MIME_TOKEN_RE` + `FileWriteSchema` boundary constants used
 * only by the PUT route. `ambient` bindings (`c.env.DB` / `c.env.CACHE_KV` /
 * `c.env.SITES_BUCKET`) need no import. Known AppErrors
 * (`unauthorized`/`badRequest`/`forbidden`/`notFound`) propagate to the app-level
 * error handler.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { DOMAINS, badRequest, forbidden, notFound, unauthorized } from '@project-sites/shared';
import type { Env, Variables } from '../../../src/types/env.js';
import { requireOwnedSite } from '../../../src/services/site_ownership.js';
import * as auditService from '../../../src/services/audit.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const siteFiles = new Hono<AppContext>();

/**
 * Sanitize a caller-supplied file path before any R2 key construction —
 * a defense-in-depth traversal filter shared by the read / write / delete
 * per-file routes.
 *
 * @param raw - Untrusted path string from `c.req.param('path')` or
 *   request body. Typically a path-rest match like `index.html` or
 *   `assets/og-image.png`.
 * @returns Cleaned path string (leading slashes stripped, backslashes
 *   normalized) when safe. `null` for any traversal attempt, null
 *   byte, percent-encoded dot-dot, or empty result — callers MUST
 *   short-circuit with a 403 when `null` returned.
 *
 * @remarks
 * Defense-in-depth filter — three sequential checks:
 * 1. **Null byte** (`\0`) reject — truncates strings in many syscalls,
 *    classic upload-bypass vector (`evil.php\0.jpg`).
 * 2. **Encoded traversal** — `%2e%2e%2f` → `../` decoded BEFORE the
 *    dot-dot check so attackers can't smuggle `..` past via URL
 *    encoding. Backslashes (`\`) normalized to `/` to defeat
 *    Windows-style traversal (`..\..\etc\passwd`).
 * 3. **Dot-dot literal** — any remaining `..` substring after decoding
 *    rejects, catching both `/foo/../bar` and `foo/../bar`.
 *
 * After validation, callers MUST additionally prefix-guard with
 * `fullKey.startsWith('sites/{slug}/')` — this function only rejects
 * the most common malicious patterns; the second gate enforces
 * cross-site isolation even for paths that happen to look benign.
 *
 * @example
 * ```ts
 * sanitizeFilePath('../../secrets.json')           // null (dot-dot)
 * sanitizeFilePath('%2e%2e/secrets.json')          // null (encoded)
 * sanitizeFilePath('assets/og\0.png')              // null (null byte)
 * sanitizeFilePath('//index.html')                 // 'index.html'
 * sanitizeFilePath('assets\\img.png')              // 'assets/img.png'
 * ```
 */
function sanitizeFilePath(raw: string): string | null {
  if (!raw || raw.includes('\0')) return null;
  // Decode percent-encoded dots and slashes to detect traversal in encoded form
  const decoded = raw.replace(/%2e/gi, '.').replace(/%2f/gi, '/').replace(/\\/g, '/');
  // Reject any path containing dot-dot traversal sequences
  if (decoded.includes('..')) return null;
  const cleaned = decoded.replace(/^\/+/, '');
  if (!cleaned) return null;
  return cleaned;
}

/**
 * List the R2 keys belonging to a single site, optionally scoped to a
 * specific build version. Powers the bolt.diy embedded-editor file
 * tree and the in-app "browse files" surface. Read-only; for writes
 * see the companion `PUT /api/sites/:id/files/:path{.+}` route.
 *
 * @route GET /api/sites/:id/files
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @queryParam version - Optional build version override (e.g.
 *   `2026-05-11-abc123`); when omitted falls back to the site's
 *   `current_build_version`. Sanitized to `[a-zA-Z0-9._-]` so a
 *   malicious caller can't construct a prefix that escapes the
 *   site's R2 namespace.
 * @returns 200 OK `{ data: { files: Array<{ key, name, size, uploaded, content_type }>, prefix, version } }`.
 *   `key` is the full R2 key; `name` is the relative path inside the
 *   prefix for display. Capped at 500 objects.
 * @throws UNAUTHORIZED — missing Bearer token.
 * @throws NOT_FOUND — site missing / cross-org / soft-deleted.
 *
 * @remarks
 * R2 prefix is always `sites/{slug}/[{version}/]` — the prefix-guard
 * here is the slug, separate from path-level traversal guards in the
 * single-file routes below. Versioned listing (`/{version}/` suffix)
 * lets the editor view a specific historical build alongside the
 * current live version.
 */
siteFiles.get('/api/sites/:id/files', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  // Canonical org-ownership guard: 404 (never 403) so cross-org sites don't leak.
  const site = await requireOwnedSite<{ slug: string; current_build_version: string | null }>(
    c.env,
    orgId,
    siteId,
    'slug, current_build_version',
  );

  const prefix = `sites/${site.slug}/`;
  const version = (c.req.query('version') || site.current_build_version || '').replace(
    /[^a-zA-Z0-9._-]/g,
    '',
  );
  const fullPrefix = version ? `${prefix}${version}/` : prefix;

  const listed = await c.env.SITES_BUCKET.list({ prefix: fullPrefix, limit: 500 });
  const files = listed.objects.map((obj) => ({
    key: obj.key,
    name: obj.key.replace(fullPrefix, ''),
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
    content_type: obj.httpMetadata?.contentType ?? null,
  }));

  return c.json({ data: { files, prefix: fullPrefix, version: version || null } });
});

/**
 * Bulk-export every text-mode file for a site as an inline
 * `{ path: content }` map. Designed for bolt.diy's embedded editor
 * mode, which boots a WebContainer and needs the full project tree in
 * a single round-trip rather than N individual `GET /files/:path`
 * fetches.
 *
 * @route GET /api/sites/:id/files-export
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @returns 200 OK `{ data: { files: Record<string, string>, prefix, version } }`.
 *   Keys are paths relative to the site prefix; values are UTF-8
 *   decoded text content.
 * @throws UNAUTHORIZED — missing Bearer token.
 * @throws NOT_FOUND — site missing / cross-org / soft-deleted.
 *
 * @remarks
 * Two safety caps prevent runaway response size: (1) **text-only
 * filter** — only `.html .css .js .json .txt .md .xml .svg .mjs .ts
 * .jsx .tsx` extensions are included; binaries (images, fonts,
 * archives) skipped because WebContainer doesn't need them at boot.
 * (2) **500KB per-file cap** — `obj.size < 512_000` skips bloated
 * generated bundles that would balloon the JSON payload. (3)
 * **200 object listing cap** — for sites with > 200 files the export
 * surface is incomplete; bolt UI falls back to lazy per-file loads.
 *
 * Promise.all + r2.get() runs in parallel — total latency bounded by
 * the slowest file, not the sum.
 *
 * @see Companion `GET /api/sites/:id/files` for paginated metadata
 *   without inlining content.
 */
siteFiles.get('/api/sites/:id/files-export', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  // Canonical org-ownership guard: 404 (never 403) so cross-org sites don't leak.
  const site = await requireOwnedSite<{ slug: string; current_build_version: string | null }>(
    c.env,
    orgId,
    siteId,
    'slug, current_build_version',
  );

  const version = site.current_build_version || '';
  const prefix = version ? `sites/${site.slug}/${version}/` : `sites/${site.slug}/`;

  const listed = await c.env.SITES_BUCKET.list({ prefix, limit: 200 });
  const textExtensions = new Set([
    'html',
    'css',
    'js',
    'json',
    'txt',
    'md',
    'xml',
    'svg',
    'mjs',
    'ts',
    'jsx',
    'tsx',
  ]);
  const files: Record<string, string> = {};

  await Promise.all(
    listed.objects
      .filter((obj) => {
        const ext = obj.key.split('.').pop()?.toLowerCase() ?? '';
        return textExtensions.has(ext) && obj.size < 512_000; // skip files > 500KB
      })
      .map(async (obj) => {
        const r2Obj = await c.env.SITES_BUCKET.get(obj.key);
        if (r2Obj) {
          const name = obj.key.replace(prefix, '');
          files[name] = await r2Obj.text();
        }
      }),
  );

  return c.json({ data: { files, prefix, version: version || null } });
});

/**
 * Read the body of a single R2-hosted file for a site. Counterpart to
 * the PUT/DELETE routes below; together they form the CRUD surface for
 * the in-app file editor.
 *
 * @route GET /api/sites/:id/files/:path{.+}
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @param path - Path-rest match (Hono `:path{.+}` regex captures
 *   everything after `/files/`, including slashes). Passed through
 *   `sanitizeFilePath()` before any R2 access — see that helper for
 *   the traversal-defense matrix.
 * @returns 200 OK `{ data: { key, content, size, content_type } }`.
 *   `content` always UTF-8 decoded (text-mode); binary files come
 *   back garbled — callers are expected to filter by extension
 *   client-side using the listing endpoint.
 * @throws UNAUTHORIZED — missing Bearer token.
 * @throws BAD_REQUEST — empty path.
 * @throws FORBIDDEN — path failed sanitization OR resolved key
 *   escaped the site's `sites/{slug}/` prefix.
 * @throws NOT_FOUND — site missing / cross-org / R2 object absent.
 *
 * @remarks
 * Two-layer security gate (defense-in-depth):
 * 1. `sanitizeFilePath` rejects `..`, null bytes, encoded traversal.
 * 2. Post-prefix `fullKey.startsWith('sites/{slug}/')` guard rejects
 *    any path that somehow snuck past sanitization (e.g. legitimate
 *    `sites/` literal prefix that points at a different slug).
 * Both must pass — never relax the prefix-guard "because the
 * sanitizer already caught it".
 */
siteFiles.get('/api/sites/:id/files/:path{.+}', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  const rawPath = c.req.param('path');
  if (!rawPath) throw badRequest('File path is required');

  // Sanitize path to prevent traversal attacks
  const filePath = sanitizeFilePath(rawPath);
  if (!filePath) throw forbidden('Invalid file path');

  // Canonical org-ownership guard: 404 (never 403) so cross-org sites don't leak.
  const site = await requireOwnedSite<{ slug: string }>(c.env, orgId, siteId, 'slug');

  // Build scoped key and validate it stays within the site's R2 scope
  const fullKey = filePath.startsWith('sites/') ? filePath : `sites/${site.slug}/${filePath}`;
  if (!fullKey.startsWith(`sites/${site.slug}/`)) {
    throw forbidden('Access denied to this file path');
  }

  const object = await c.env.SITES_BUCKET.get(fullKey);
  if (!object) throw notFound('File not found');

  const content = await object.text();
  return c.json({
    data: {
      key: fullKey,
      content,
      size: object.size,
      content_type: object.httpMetadata?.contentType ?? null,
    },
  });
});

/**
 * Body contract for `PUT /api/sites/:id/files/:path`. `content_type` (optional
 * override of the extension-derived type) is constrained to a well-formed MIME
 * token — it lands in the served R2 object's Content-Type header, so a
 * CRLF/control-char value is a header-injection vector. Malformed JSON → 400.
 */
const MIME_TOKEN_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const FileWriteSchema = z.object({
  content: z.string(),
  content_type: z.string().max(128).regex(MIME_TOKEN_RE).optional(),
});

/**
 * Create or overwrite a single R2 file for a site. Used by the in-app
 * editor's save action and by bolt.diy's "publish from editor" path.
 * Differentiates `file.created` vs. `file.updated` in audit logs by
 * HEAD-probing the key first.
 *
 * @route PUT /api/sites/:id/files/:path{.+}
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @param path - Path-rest match, sanitized + prefix-guarded (see GET).
 * @body application/json `{ content: string, content_type?: string }`.
 *   When `content_type` omitted, derived from extension:
 *   `.html` → `text/html`, `.json` → `application/json`, `.css` →
 *   `text/css`, `.js` → `application/javascript`, else `text/plain`.
 * @returns 200 OK `{ data: { key, size, updated: true } }`.
 * @throws UNAUTHORIZED — missing Bearer token.
 * @throws BAD_REQUEST — empty path OR non-string `content`.
 * @throws FORBIDDEN — path failed sanitization OR escaped site prefix.
 * @throws NOT_FOUND — site missing / cross-org / soft-deleted.
 *
 * @remarks
 * Side effects beyond the R2 write:
 * 1. **KV cache invalidation** — `host:{slug}{SITES_SUFFIX}` purged so
 *    next visitor request rebuilds the cache from fresh R2 state
 *    rather than serving the stale (pre-edit) version. Best-effort
 *    with `.catch(() => {})` because KV write failures don't matter
 *    much — TTL is 60s so worst case is one minute of staleness.
 * 2. **Audit log** with `file.created` vs `file.updated` discriminator
 *    based on the HEAD probe, plus a human-readable message with the
 *    file size in KB for the audit-log UI.
 *
 * The HEAD probe is one extra R2 round-trip per save — acceptable
 * cost since save is user-initiated, not hot-path.
 */
siteFiles.put('/api/sites/:id/files/:path{.+}', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  const rawPath = c.req.param('path');
  if (!rawPath) throw badRequest('File path is required');

  // Sanitize path to prevent traversal attacks
  const filePath = sanitizeFilePath(rawPath);
  if (!filePath) throw forbidden('Invalid file path');

  // Canonical org-ownership guard: 404 (never 403) so cross-org sites don't leak.
  const site = await requireOwnedSite<{ slug: string }>(c.env, orgId, siteId, 'slug');

  const fullKey = filePath.startsWith('sites/') ? filePath : `sites/${site.slug}/${filePath}`;
  if (!fullKey.startsWith(`sites/${site.slug}/`)) {
    throw forbidden('Access denied to this file path');
  }

  const parsed = FileWriteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw badRequest('Body must be { content: string, content_type?: <valid MIME type> }');
  }
  const body = parsed.data;

  const contentType =
    body.content_type ||
    (fullKey.endsWith('.html')
      ? 'text/html'
      : fullKey.endsWith('.json')
        ? 'application/json'
        : fullKey.endsWith('.css')
          ? 'text/css'
          : fullKey.endsWith('.js')
            ? 'application/javascript'
            : 'text/plain');

  // Check if file already exists (to differentiate create vs update)
  const existingFile = await c.env.SITES_BUCKET.head(fullKey);
  const isNewFile = !existingFile;

  await c.env.SITES_BUCKET.put(fullKey, body.content, {
    httpMetadata: { contentType },
  });

  // Invalidate KV cache
  await c.env.CACHE_KV.delete(`host:${site.slug}${DOMAINS.SITES_SUFFIX}`).catch(() => {});

  // Extract just the filename from the full key for display
  const fileName = fullKey.split('/').pop() || fullKey;
  const fileSizeKb = Math.round(body.content.length / 1024);

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: isNewFile ? 'file.created' : 'file.updated',
    message: `${isNewFile ? 'File created' : 'File updated'}: '${fileName}' (${fileSizeKb} KB) on site '${siteId}'`,
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      key: fullKey,
      file_name: fileName,
      size: body.content.length,
    },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { key: fullKey, size: body.content.length, updated: true } });
});

/**
 * Hard-delete a single R2-hosted file for a site. R2 has no native
 * recycle-bin and we don't soft-delete files (only D1 rows soft-delete
 * here) — once removed, the file is gone unless restored from a
 * site_snapshot. Use sparingly via the editor UI's destructive-confirm
 * dialog.
 *
 * @route DELETE /api/sites/:id/files/:path{.+}
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @param path - Path-rest match, sanitized + prefix-guarded.
 * @returns 200 OK `{ data: { key, deleted: true } }`.
 * @throws UNAUTHORIZED — missing Bearer token.
 * @throws BAD_REQUEST — empty path.
 * @throws FORBIDDEN — path failed sanitization OR escaped site prefix.
 * @throws NOT_FOUND — site missing / cross-org / soft-deleted.
 *
 * @remarks
 * Audit log entry uses `file.deleted` action with the bare filename
 * (basename) in the human-readable message — the full key is in the
 * `metadata_json.key` field for forensic queries. KV cache invalidated
 * same as the PUT route so visitors don't get a 404 for a file that
 * was edited+deleted in the same minute.
 *
 * Restoration path: bolt.diy users can revert to any `site_snapshots`
 * row via the snapshots UI (see `POST /api/sites/:siteId/snapshots`
 * and the snapshot-restore route below) — that's the supported
 * "undo delete" workflow.
 */
siteFiles.delete('/api/sites/:id/files/:path{.+}', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  const rawPath = c.req.param('path');
  if (!rawPath) throw badRequest('File path is required');

  const filePath = sanitizeFilePath(rawPath);
  if (!filePath) throw forbidden('Invalid file path');

  // Canonical org-ownership guard: 404 (never 403) so cross-org sites don't leak.
  const site = await requireOwnedSite<{ slug: string }>(c.env, orgId, siteId, 'slug');

  const fullKey = filePath.startsWith('sites/') ? filePath : `sites/${site.slug}/${filePath}`;
  if (!fullKey.startsWith(`sites/${site.slug}/`)) {
    throw forbidden('Access denied to this file path');
  }

  await c.env.SITES_BUCKET.delete(fullKey);

  // Invalidate KV cache
  await c.env.CACHE_KV.delete(`host:${site.slug}${DOMAINS.SITES_SUFFIX}`).catch(() => {});

  const fileName = fullKey.split('/').pop() || fullKey;

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'file.deleted',
    message: `File '${fileName}' deleted from site '${siteId}'`,
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      key: fullKey,
      file_name: fileName,
    },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { key: fullKey, deleted: true } });
});
