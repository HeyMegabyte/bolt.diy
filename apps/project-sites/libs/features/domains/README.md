# domains

Domain availability search, AI suggestions, Stripe-checkout purchase, direct
Cloudflare-Registrar registration, and per-site domain management (AI search /
availability / register / transfer-out). **Core, un-gated** routes (no feature
flag) — a route-organization module extracted from the `api.ts` monolith (platform
`/api/domains/*` in installment 1; the site-scoped `/api/sites/:siteId/domains/*`
routes folded in at installment 11), not a dark-launched feature.

## Routes (`handlers.ts` → `domains`, mounted at `app.route('/', domains)`)

| Method | Path                                  | Auth   |
| ------ | ------------------------------------- | ------ |
| GET    | `/api/domains/search-enrich`          | public |
| GET    | `/api/domains/search`                 | public |
| POST   | `/api/domains/purchase`               | orgId  |
| POST   | `/api/domains/register`               | orgId  |
| GET    | `/api/domains/suggest`                | orgId  |
| POST   | `/api/domains/suggest/refine`         | orgId  |
| GET    | `/api/admin/profile/:site_id/context` | orgId  |
| POST   | `/api/sites/:siteId/domains/ai-search`             | orgId  |
| GET    | `/api/sites/:siteId/domains/availability`          | orgId  |
| POST   | `/api/sites/:siteId/domains/register`              | orgId  |
| POST   | `/api/sites/:siteId/domains/:domain/transfer-out`  | orgId  |

## Boundaries

- Every request body/query is validated through `schemas.ts` at the boundary
  (zod-everywhere). The former `/register` `as { domain?; site_id? }` cast is now
  `DomainRegisterSchema`.
- Business logic lives in `src/services/*` (`cf_registrar`, `rdap_availability`,
  `domain_suggester`, `profile_context`, `domains`); handlers stay thin.
- Org-ownership is enforced via `requireOwnedSite` (404 never 403). Stripe
  redirect URLs are clamped to the site's own domains (`pickSafeRedirect`).
- Thrown `badRequest` / `unauthorized` / `notFound` are formatted by the
  app-level error handler.
