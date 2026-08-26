# conversion_checkout

`POST /api/conversion/checkout` — the **public** conversion funnel: creates a Stripe
Checkout session for an anonymous visitor upgrading a site (domain/plan). **Core,
un-gated** — a route-organization module extracted VERBATIM from the `search.ts`
monolith (route-decomposition installment 28); a payments concern that never belonged
in the search-routes file.

## Routes (`handlers.ts` → `conversionCheckout`, mounted at `app.route('/', conversionCheckout)`)

| Method | Path                        | Auth   |
| ------ | --------------------------- | ------ |
| POST   | `/api/conversion/checkout`  | public |

## Boundaries

- **Public** (no org auth) — deliberately NOT folded into the org-scoped `billing`
  module, whose routes require `c.get('orgId')`. The auth models differ; folding would
  change the funnel's semantics. It stays its own public module.
- Looks up the site (dynamic `import('../../../src/services/db.js')` → `dbQueryOne`),
  then calls the Stripe REST API (`STRIPE_SECRET_KEY`) to mint a Checkout session with
  success/cancel URLs on the site's public origin (`DOMAINS.SITES_SUFFIX`).
- The dynamic db-import path is `../../../src/` (re-depthed from search.ts's `../` for
  the deeper module location).
