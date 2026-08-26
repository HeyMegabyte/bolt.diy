# site_files

Editor **R2 file CRUD** for a published site — the list / bulk-export / read / write /
delete surface behind the in-app editor and bolt.diy's embedded WebContainer mode.
**Core, un-gated** routes (no feature flag) — a route-organization module extracted
from the `api.ts` monolith (route-decomposition installment 10), not a dark-launched
feature.

## Routes (`handlers.ts` → `siteFiles`, mounted at `app.route('/', siteFiles)`)

| Method | Path                              | Auth  |
| ------ | --------------------------------- | ----- |
| GET    | `/api/sites/:id/files`            | orgId |
| GET    | `/api/sites/:id/files-export`     | orgId |
| GET    | `/api/sites/:id/files/:path{.+}`  | orgId |
| PUT    | `/api/sites/:id/files/:path{.+}`  | orgId |
| DELETE | `/api/sites/:id/files/:path{.+}`  | orgId |

## Boundaries

- Every route is org-scoped via `c.get('orgId')` and guards ownership through
  `requireOwnedSite` — a missing / foreign / soft-deleted site collapses to **404**
  (never 403), so cross-org sites never leak. Files live at
  `sites/{slug}/[{version}/]{path}` on R2 (`c.env.SITES_BUCKET`).
- Per-file routes are defense-in-depth: the path passes through the module-private
  `sanitizeFilePath` (rejects `..`, null bytes, percent-encoded traversal, backslash
  traversal) AND a post-sanitize `fullKey.startsWith('sites/{slug}/')` prefix-guard.
  Both must pass — the prefix-guard is never relaxed "because the sanitizer caught it".
- `PUT` is the only route with a request body — validated by the module-private
  `FileWriteSchema` (`content: string`, optional `content_type` constrained to a
  well-formed MIME token via `MIME_TOKEN_RE`, so a CRLF/control-char value can't be
  smuggled into the served object's `Content-Type` header). Malformed JSON → 400.
  There is no shared `schemas.ts`; the schema is colocated in `handlers.ts`.
- `PUT`/`DELETE` purge the `host:{slug}{SITES_SUFFIX}` KV entry (best-effort) and write
  a `file.created` / `file.updated` / `file.deleted` audit row via `auditService`.
- `GET /files-export` is capped for WebContainer boot: text-only extensions, ≤500KB per
  file, ≤200-object listing. Known AppErrors
  (`unauthorized`/`badRequest`/`forbidden`/`notFound`) bubble to the app-level handler.
