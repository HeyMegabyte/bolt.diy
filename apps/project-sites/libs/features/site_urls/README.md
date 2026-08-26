# site_urls

Site **URL management + multi-URL analytics** — the `site_urls` table (primary +
alternate hostnames bound to a site) plus the aggregated Cloudflare-analytics rollup
across every bound URL. **Core, un-gated** routes (no feature flag) — a
route-organization module extracted from the `api.ts` monolith (route-decomposition
installment 10), not a dark-launched feature.

## Routes (`handlers.ts` → `siteUrls`, mounted at `app.route('/', siteUrls)`)

| Method | Path                                 | Auth       |
| ------ | ------------------------------------ | ---------- |
| GET    | `/api/sites/:id/urls`                | membership |
| POST   | `/api/sites/:id/urls`                | membership |
| DELETE | `/api/sites/:id/urls/:urlId`         | membership |
| GET    | `/api/sites/:id/multi-url-analytics` | membership |

## Boundaries

- Every route loads the site + verifies org membership through the module-private
  `loadSiteAndAuth` helper (moved alongside the routes — its only callers): 401 when
  unauthenticated, 404 when the site is missing, 403 when the caller isn't a member of
  the site's org. On success it returns `{ site, requestId }`; on failure it returns
  `{ err }` carrying a pre-written 4xx JSON envelope the handler returns directly.
- `GET /urls` and `GET /multi-url-analytics` auto-heal a missing primary URL row (older
  sites created before migration 0027) by inserting `{ hostname, is_primary: 1 }`.
- `POST /urls` binds an alternate hostname (inline regex validation → 400; `site_urls`
  UNIQUE(hostname) collision → 409). It does NOT provision the Cloudflare custom
  hostname — that stays on `/api/sites/:siteId/hostnames`. Bodies are read via a raw
  `as {…}` cast (no shared `schemas.ts`).
- `DELETE /urls/:urlId` soft-deletes an alternate (409 if it's the primary — swap the
  primary first). A genuine DB failure surfaces as `internalError` rather than a lying
  `{ deleted: true }`.
- The path is `/multi-url-analytics`, **NOT** `/analytics` — the `site_analytics`
  SUMMARY handler (mounted first) owns `/api/sites/:siteId/analytics` and would shadow
  it. The aggregated envelope is cached in KV for 5 minutes; a CF-API failure returns a
  502.
