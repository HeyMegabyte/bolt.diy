# ai_context

AI context / knowledge management — context files (uploads + Google Drive
sync) that feed a site's AI-chat knowledge base, extracted from `ai_admin.ts`
(route-decomposition installment 16). Two file stores live here: the legacy
`ai_chat_context_files` table (`/ai-chat/context-files*`, text-only extraction,
5 MB cap) and the newer `ai_context_files` table (`/ai/context/*`, PDF/image
Vision extraction, 10 MB cap, drive-sourced rows) plus the Google-Drive OAuth +
folder-sync surface that ingests into it. **Core, un-gated** routes (no feature
flag) — a route-organization module extracted from the `ai_admin.ts` monolith,
not a dark-launched feature.

## Routes (`handlers.ts` → `aiContext`, mounted at `app.route('/', aiContext)`)

| Method | Path                                                    | Auth         | Purpose                                                    |
| ------ | ------------------------------------------------------- | ------------ | --------------------------------------------------------- |
| GET    | `/api/sites/:siteId/ai-chat/context-files`              | orgId+userId | List legacy AI-chat context files (metadata only)         |
| POST   | `/api/sites/:siteId/ai-chat/context-files`              | orgId+userId | Upload a legacy context file (multipart, 5 MB, text)      |
| DELETE | `/api/sites/:siteId/ai-chat/context-files/:fileId`      | orgId+userId | Remove a legacy context file (R2 + D1)                   |
| POST   | `/api/sites/:siteId/ai/context/upload`                  | orgId+userId | Upload a PDF/image (multipart, 10 MB, Vision-extract)     |
| GET    | `/api/sites/:siteId/ai/context/files`                   | orgId+userId | List context files (uploads + drive ingests)             |
| DELETE | `/api/sites/:siteId/ai/context/files/:fileId`           | orgId+userId | Soft-delete a context file (R2 best-effort)              |
| GET    | `/api/sites/:siteId/ai/drive/auth-url`                  | orgId+userId | Build the Google Drive OAuth consent URL                 |
| POST   | `/api/sites/:siteId/ai/drive/folders`                   | orgId+userId | List readable Drive folders (optional name filter)       |
| POST   | `/api/sites/:siteId/ai/drive/select-folder`             | orgId+userId | Persist chosen folder + trigger an immediate sync        |
| POST   | `/api/sites/:siteId/ai/drive/sync`                      | orgId+userId | Re-pull the configured folder (Workflow or inline)       |
| GET    | `/api/sites/:siteId/ai/context/summary`                 | orgId+userId | Markdown digest of every AI-chat input (60s KV cache)    |

## Boundaries

- Every route requires BOTH an `orgId` AND a `userId` on the request context —
  the local `need(c)` helper throws `HTTPError(401)` when either is missing.
- Site ownership is guarded through the local `siteOwned(...)` helper — a
  missing/foreign site collapses to **404 (never 403)** so cross-org sites don't
  leak.
- File bodies land in R2 (`c.env.SITES_BUCKET`) and metadata + extracted text in
  D1 (`c.env.DB`). The Google-Drive sync fires the `DRIVE_SYNC_WORKFLOW` binding
  when bound (returns a status URL), else runs the inline `syncDriveFolder` path.
- Delegates to `services/ai_context_extract.ts` (`extractContext` /
  `MAX_CONTEXT_FILE_BYTES` for PDF/image Vision extraction),
  `services/google_drive.ts` (`buildAuthUrl` / `getAccessToken` / `listFolders` /
  `DRIVE_SCOPE`), `services/ai_drive_sync.ts` (`syncDriveFolder`), and
  `utils/safe-parse.ts` (`safeParseJSONOrNull` guarding the summary's KV cache
  read). Audit writes for the legacy `/ai-chat/context-files` routes go through
  `services/audit.ts` (`writeAuditLog`) via `c.executionCtx.waitUntil(...)`.
- No request body is Zod-validated at the boundary — the drive `folders` /
  `select-folder` bodies use the original in-body `as {…}` cast +
  `.catch(() => ({}))` + manual checks, so there is no `schemas.ts`.

## Extraction notes

Extracted VERBATIM from `ai_admin.ts` — only the route-registration receiver
changed (`aiAdmin.` → `aiContext.`); the handler bodies (and the local
`driveCallbackUrl` / `triggerDriveSync` / `renderContextMarkdown` helpers) are
byte-for-byte unchanged. The module reproduces ai_admin's EXACT error scaffolding
(the `HTTPError` class, the `need` / `siteOwned` / `safeJson` helpers, and a
byte-identical `onError`). Because this module contains ONLY these
ai_admin-sourced routes, exact reproduction = byte-identical behavior; no
shared-`AppError` re-throw is needed (there are no pre-existing non-ai_admin
routes to fall through to).

The `GET /api/sites/:siteId/workflows/:wfName/:id` proxy (also touching
`DRIVE_SYNC_WORKFLOW`) intentionally STAYED in `ai_admin.ts` — it serves both
`drive-sync` and `image-generation` workflow status, not just context ingest, so
it belongs with the broader admin surface, not this knowledge-management module.
