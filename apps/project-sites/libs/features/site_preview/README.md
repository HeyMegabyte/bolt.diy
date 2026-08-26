# site_preview

`GET /api/sites/:slug/preview` — serves a site's built `index.html` straight from R2
so the admin panel can render a preview **without** hitting the subdomain-serving path
(which triggers CF challenges). Public read, no D1. **Core, un-gated** — a
route-organization module extracted VERBATIM from the `search.ts` monolith
(route-decomposition installment 28); a site-serving concern that never belonged in
the search-routes file.

## Routes (`handlers.ts` → `sitePreview`, mounted at `app.route('/', sitePreview)`)

| Method | Path                        | Auth   |
| ------ | --------------------------- | ------ |
| GET    | `/api/sites/:slug/preview`  | public |

## Boundaries

- Reads `sites/{slug}/{version}/index.html` from R2 (`SITES_BUCKET`); rewrites the
  document `<base href>` to the site's public origin (`DOMAINS.SITES_SUFFIX`) so
  relative asset URLs resolve.
- **Mounts before `api`** (mirrors `src/index.ts`) so `/api/sites/:slug/preview`
  wins over api's `/api/sites/:id`.
