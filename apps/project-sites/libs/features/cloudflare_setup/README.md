# cloudflare_setup

The admin **Cloudflare account provisioning** wizard — a status probe and an
idempotent auto-setup that ensures the Workers-for-Platforms dispatch namespace
exists. Both inspect whatever CF auth the worker already holds (scoped
`CF_API_TOKEN` preferred, global `CLOUDFLARE_API_KEY`/`CLOUDFLARE_EMAIL`
fallback) so the onboarding view matches reality. **Core, un-gated** routes (no
feature flag) — a route-organization module extracted VERBATIM from the
`ai_admin.ts` monolith (route-decomposition installment 20), not a dark-launched
feature.

## Routes (`handlers.ts` → `cloudflareSetup`, mounted at `app.route('/', cloudflareSetup)`)

| Method | Path                              | Auth  |
| ------ | --------------------------------- | ----- |
| GET    | `/api/admin/cloudflare/status`    | orgId |
| POST   | `/api/admin/cloudflare/auto-setup`| orgId |

## Boundaries

- Both routes are org-scoped via `need(c)` (`HTTPError(401)` when `orgId`/`userId`
  is absent). No org data is read/written — the status/auto-setup act on the
  worker's own CF account credentials.
- `auto-setup` is idempotent: it verifies account access by listing dispatch
  namespaces, then creates the target namespace only when absent. Failure modes
  map to `503 NO_ACCOUNT`/`NO_AUTH`, `502 CF_AUTH_FAILED`/`NAMESPACE_CREATE_FAILED`.
- Error/auth scaffolding (`need` + `onError`) is imported from the shared
  `src/lib/ai_admin_kit.ts` — no local copies.
