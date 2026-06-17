# storefront_ecommerce

AI-generated product catalog and storefront with cart state backed by KV.

## Flag key

`storefront_ecommerce`

## Rollout defaults

`enabled=0, rollout_percent=0, stage='experimental'`

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/storefront/catalog` | Paginated product catalog for a site |
| GET | `/api/storefront/products/:id` | Single product detail with related IDs |
| POST | `/api/storefront/cart` | Upsert cart (create or update lines) |

## Storage

- `storefront_products` (D1) — product catalog rows per org/site
- KV `cart:{cartId}` — ephemeral cart state with 24h TTL (`expirationTtl: 86400`)

## Safe disabled behavior

When `storefront_ecommerce` flag is off, all three routes return `404`. No `403` — flag existence is never leaked.

## Auth requirements

All routes require a valid session (`userId` must be present). Missing session returns `401`.

## Cart semantics

- `POST /api/storefront/cart` with no `cartId` creates a new cart and returns a fresh UUID.
- Re-posting with an existing `cartId` replaces the cart lines entirely (upsert).
- Carts expire 24 hours after the last write.
- `siteId` is derived from the first product resolved — all products in a cart must belong to the same site.

## Module files

- `feature.manifest.ts` — manifest with 7 required fields
- `schemas.ts` — Zod schemas for catalog, product, and cart shapes
- `service.ts` — D1 catalog queries + KV cart helpers
- `handlers.ts` — Hono route handlers
- `__tests__/storefront_ecommerce.test.ts` — Jest unit tests (D1 + KV mock pattern)

## E2E coverage

`apps/project-sites/e2e/storefront_ecommerce/`

## Owner

brian@megabyte.space
