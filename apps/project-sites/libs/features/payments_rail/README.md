# payments_rail

Unified payment rail abstracting Stripe and Square into a single API surface.

## Flag key

`payments_rail`

## Rollout defaults

`enabled=0, rollout_percent=0, stage='experimental'`

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/payments/methods` | List stored payment methods for the org |
| POST | `/api/payments/intent` | Create a payment intent (Stripe or Square) |
| GET | `/api/payments/history` | Paginated payment event history |

## D1 tables

- `payments_rail_methods` — stored payment methods per org
- `payments_rail_events` — immutable payment event log (intentId, amountCents, status)

## Safe disabled behavior

When `payments_rail` flag is off, all three routes return `404`. The flag existence is never leaked via a `403`.

## Auth requirements

All routes require a valid session (`userId` must be present). Missing session returns `401`.

## Module files

- `feature.manifest.ts` — manifest with 7 required fields
- `schemas.ts` — Zod schemas for all request/response shapes
- `service.ts` — D1 query helpers for methods + event log
- `handlers.ts` — Hono route handlers
- `__tests__/payments_rail.test.ts` — Jest unit tests (D1 mock pattern)

## E2E coverage

`apps/project-sites/e2e/payments_rail/`

## Owner

brian@megabyte.space
