# site_by_slug

Public-by-slug **site data reads** for the bolt.diy editor — the endpoints the
editor hits to bootstrap a workbench from a published site's R2 artifacts.
**Core, un-gated** route-organization module extracted from `api.ts`
(route-decomposition installment 13), not a dark-launched feature.

## Routes (`handlers.ts` → `siteBySlug`, mounted at `app.route('/', siteBySlug)`)

| Method | Path                                     | Auth        |
| ------ | ---------------------------------------- | ----------- |
| GET    | `/api/sites/by-slug/:slug/build-context` | public      |
| GET    | `/api/sites/by-slug/:slug/chat`          | public      |
| GET    | `/api/sites/by-slug/:slug/files`         | public      |
| GET    | `/api/sites/by-slug/:slug/research.json` | conditional |

## Boundaries

- `build-context` / `chat` / `files` are unauthenticated by design — the slug +
  R2 obscurity are the access token and no PII is stored in these payloads; the
  `chat`/`files` handlers filter binaries server-side so they can't exfiltrate
  non-text assets. `research.json` is additionally org-scoped (`WHERE slug = ?
  AND org_id = ? AND deleted_at IS NULL`) UNLESS `RESEARCH_JSON_PUBLIC === 'true'`.
- Reads directly from `c.env.SITES_BUCKET` (R2) and `c.env.DB` (D1) — the site
  root `_manifest.json` (or D1 `current_build_version` fallback) points at the
  current build version; `dbQueryOne` (`../../../src/services/db.js`) is the sole
  DB helper (research.json org-ownership check). The private
  `emptyBoltChatResponse` helper moved alongside its only caller (`/chat`).
- No request body is parsed; inputs are a path param + `RESEARCH_JSON_PUBLIC`, so
  there is no `schemas.ts`. Known AppErrors (`unauthorized`/`notFound`) bubble to
  the app-level error handler unchanged.
