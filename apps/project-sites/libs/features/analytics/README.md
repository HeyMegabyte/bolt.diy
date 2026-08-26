# analytics

The **analytics** surface: the admin SPA's per-route visit beacon, the rolling
overview tiles (Cloudflare Analytics Engine + D1 funnel events), and the per-site
dashboard feed (GA4 Data API → Cloudflare zone analytics → first-party edge
pageviews fallback chain). **Core, un-gated** routes (no feature flag) — a
route-organization module extracted from `ai_admin.ts` + `api.ts`
(route-decomposition installment 14), not a dark-launched feature.

## Routes (`handlers.ts` → `analytics`, mounted at `app.route('/', analytics)`)

| Method | Path                      | Auth   | Purpose                                              |
| ------ | ------------------------- | ------ | ---------------------------------------------------- |
| POST   | `/api/analytics/track`    | public | Record one admin-visit Analytics Engine data point   |
| GET    | `/api/analytics/overview` | orgId  | Rolling 1/7/30/90-day analytics summary              |
| GET    | `/api/analytics/:siteId`  | member | Per-site dashboard feed (GA4 → CF zone → edge)       |

## Boundaries

- `POST /api/analytics/track` is intentionally **public** — the admin SPA fires
  it on every route change and it degrades to an `anonymous` org tag when
  unauthenticated (never 401s), recording one `admin_visit` Analytics Engine data
  point via `recordEvent`. `GET /api/analytics/overview` is org-scoped via
  `c.get('orgId')` (401 `{ error: { message: 'Authentication required' } }` when
  missing) and returns a rolling summary from `loadOverview` (CF Analytics + D1
  funnel events), degrading to a `200 { data: null, error }` envelope rather than
  a 500 when the analytics store is unavailable.
- `GET /api/analytics/:siteId` is membership-scoped: it looks up the site
  (`dbQueryOne`, 404 on missing/soft-deleted), then verifies the caller has a
  `memberships` row in the site's org (403 on none), returning its own inline
  `{ error: { code, message, request_id } }` envelopes. It walks a three-tier
  fallback: GA4 Data API (`queryGa4DataApi`, when `GA4_PROPERTY_ID` +
  `GA4_SERVICE_ACCOUNT_JSON` are set) → Cloudflare zone analytics
  (`isCloudflareAnalyticsConfigured` / `loadSiteTraffic`) → first-party edge
  pageviews (`getTrafficSummary` + a `visitor_events` daily-count query). Every
  tier is wrapped so the dashboard never 500s — the last-ditch branch returns an
  empty envelope.
- The two ai_admin-derived routes (`track` / `overview`) keep ai_admin's local
  scaffolding (the `HTTPError` class + `need(c)` auth gate + this module's
  `onError`) so `overview`'s 401 envelope + generic-500 behavior stay
  byte-identical to the ai_admin surface. The private `queryGa4DataApi` helper
  moved alongside its only caller (the `:siteId` route), mirroring how
  `guessContentTypeForRevert` travels with the revert handler in
  `site_versioning`.
- No request body is Zod-validated at the boundary — `track` reads its body with
  `c.req.json().catch(() => ({}))` and the reads take only query params, so there
  is no `schemas.ts`. GA4 credentials, the CF zone token, and the visitor-events
  store are all read through their respective services (`cf_analytics`,
  `cloudflare_analytics`, `visitor_events_core`); this module holds no secrets.
- This module MUST mount **before** both `api` and `aiAdmin` so its
  `/api/analytics/*` routes win over the originals (extracted from those two
  monoliths in the same installment).
