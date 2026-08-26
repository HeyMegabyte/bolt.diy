# org_security

Per-org **security settings** — session TTL, idle timeout, sign-in domain
allowlist, and the 2FA-required toggle — persisted one row per org in the
`org_security` D1 table (upsert on conflict). Backs the admin **Settings →
Security** view. **Core, un-gated** routes (no feature flag) — a
route-organization module extracted VERBATIM from the `ai_admin.ts` monolith
(route-decomposition installment 20), not a dark-launched feature.

## Routes (`handlers.ts` → `orgSecurity`, mounted at `app.route('/', orgSecurity)`)

| Method | Path                  | Auth  |
| ------ | --------------------- | ----- |
| GET    | `/api/admin/security` | orgId |
| PUT    | `/api/admin/security` | orgId |

## Boundaries

- Both routes are org-scoped via `need(c)` (`HTTPError(401)` when `orgId`/`userId`
  is absent). No cross-site or cross-org access — every read/write is keyed on the
  caller's own `orgId`.
- `PUT` clamps raw inputs inline (session 1–720h, idle 5–240m; `allowed_domains`
  trimmed-or-null; `require_2fa` coerced to 0/1) exactly as the original did, so
  there is no `schemas.ts`.
- Error/auth scaffolding (`need` + `onError`) is imported from the shared
  `src/lib/ai_admin_kit.ts` — no local copies.
