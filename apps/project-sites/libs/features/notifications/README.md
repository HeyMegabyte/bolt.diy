# notifications

The owner-dashboard bell inbox: list in-app notifications, mark one read, mark
all read. **Core, un-gated** routes (no feature flag) — a route-organization
module extracted from the `api.ts` monolith (route-decomposition installment 2),
not a dark-launched feature.

## Routes (`handlers.ts` → `notifications`, mounted at `app.route('/', notifications)`)

| Method | Path                          | Auth   |
| ------ | ----------------------------- | ------ |
| GET    | `/api/notifications`          | userId |
| PATCH  | `/api/notifications/:id/read` | userId |
| POST   | `/api/notifications/read-all` | userId |

## Boundaries

- Every route is user-scoped via `c.get('userId')` — a missing identity returns a
  `401 UNAUTHORIZED` envelope directly. Every D1 write carries `AND user_id = ?`
  so a caller can never mutate another user's rows, even by guessing an id.
- No request body/params are cast via `as {…}`: the id comes from
  `c.req.param('id')` and the only query (`limit`) is numerically clamped (≤100),
  so there is no `schemas.ts` (nothing to Zod-validate at the boundary).
- D1 access uses the shared `dbQuery` helper (reads) + `c.env.DB.prepare(...).run()`
  (writes). Unknown errors are classified via `classifyError()` and returned as an
  `INTERNAL_ERROR` envelope; known AppErrors (objects with `code`) are re-thrown so
  the app-level error handler preserves their status.

## Note

This module is distinct from `notification_badge/` (the unread-count bell badge)
and the `GET /api/notifications/badge` endpoint that lives on the root app — both
remain untouched.
