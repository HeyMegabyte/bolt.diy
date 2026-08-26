# site_data_api

Per-site **D1 data tables** — a generic key→JSON row store (`site_data`) that
generated websites poll to stay in sync, plus the authenticated admin CRUD
behind it. One public host-resolved read endpoint and four org-scoped admin
endpoints (list tables, read/upsert/delete rows). Table names are whitelisted
(`ALLOWED_PUBLIC_TABLES`) to prevent data leaks. **Core, un-gated** routes (no
feature flag) — the FIRST route-organization module extracted VERBATIM from the
`search.ts` monolith (route-decomposition installment 21), not a dark-launched
feature.

## Routes (`handlers.ts` → `siteDataApi`, mounted at `app.route('/', siteDataApi)`)

| Method | Path                                   | Auth   |
| ------ | -------------------------------------- | ------ |
| GET    | `/api/public-data/:table`              | public |
| GET    | `/api/sites/:siteId/data/:table`       | orgId  |
| PUT    | `/api/sites/:siteId/data/:table/:rowId`| orgId  |
| DELETE | `/api/sites/:siteId/data/:table/:rowId`| orgId  |
| GET    | `/api/sites/:siteId/data`              | orgId  |

## Boundaries

- `/api/public-data/:table` is public by design (generated sites poll it with no
  session); it resolves the site from the request `host` and only ever reads
  whitelisted tables, returning a cache-friendly `{ data: [] }` on any error.
- The four `/api/sites/:siteId/data/*` admin routes are org-scoped via
  `c.get('orgId')` (401 when absent) AND guarded by `ownsSiteData(db, siteId,
  orgId)` — a foreign/missing `:siteId` returns 404, never 403, so cross-org
  `site_data` never leaks (the IDOR guard; `orgId` alone would only satisfy the
  401 check).
- No `schemas.ts`: the PUT clamps its body inline (object-guard + `data_json`
  serialization) exactly as the original did. Routes return explicit JSON with
  inline status codes and bubble unexpected throws to the app-level error
  handler (no local `onError`), matching `search.ts`.
- **Must mount before `api`** (and before `search`) so `/api/sites/:siteId/data`
  wins over `api`'s `/api/sites/:id` param routes — the precedence `search.ts`
  held.
