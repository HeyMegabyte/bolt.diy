# api_keys

Org-scoped programmatic API keys (`psk_live_*`) for the projectsites.dev REST API — the admin surface that mints, lists, and revokes bearer keys. Only the SHA-256 hash + a 16-char prefix persist to the D1 `api_keys` table; the full secret is shown to the user EXACTLY once at creation.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/admin/api-keys` | List org API keys (no secret bodies) |
| POST | `/api/admin/api-keys` | Mint a new key — returns `psk_live_…` ONCE |
| DELETE | `/api/admin/api-keys/:id` | Revoke a key (`revoked_at = now()`) |

## Provenance

Extracted VERBATIM from `src/routes/ai_admin.ts` (route-decomposition installment 19). Only the route receiver changed (`aiAdmin.` → `apiKeys.`); the handler bodies + the module-private `hashApiKey` helper (SHA-256 → hex, used by no other ai_admin route) are byte-for-byte unchanged.

## Dependencies

- **Kit** (`src/lib/ai_admin_kit.ts`): `need`, `safeJson`, `aiAdminOnError`. No local scaffolding.
- **Keystore**: the D1 `api_keys` table accessed directly via `c.env.DB` (parameterized SQL). There is **NO** separate `api_keys`/`api_tokens` service behind these routes — `hashApiKey` (local) is the only crypto dependency and it moved here with the routes.

## Wiring

`src/index.ts` mounts `apiKeys` before both `api` and `aiAdmin`. No feature flag — org+user-scoped via `need()`, same class as `aiSettings`/`aiEndpoints`/`aiContext`.
