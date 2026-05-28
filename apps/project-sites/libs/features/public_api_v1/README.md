# public_api_v1

Big-bets feature #30 — Public API v1. Headless access to projectsites for
developers, CLI power-users, and integrations via psk_ Bearer tokens.

## What it does

- **12 REST endpoints** under `/v1/*` covering sites CRUD, snapshots, deploy,
  media, forms/submissions, and per-site analytics.
- **psk_<64-hex> token auth** — SHA-256 hashed at rest; scope-enforced per
  endpoint (`sites:read`, `sites:write`, `media:read`, `media:write`,
  `forms:read`, `analytics:read`, `me:read`).
- **Token management** — `/api/v1-tokens` (create/list/revoke) guarded by
  session auth (not token auth). Admin UI at `/admin/api-tokens`.
- **OpenAPI 3.1** — `/v1/openapi.json` serves the full machine-readable spec.
- **`@projectsites/sdk`** — `packages/sdk/` — ESM TypeScript client with
  retry-backoff; published to npm.
- **`psctl` CLI** — `packages/psctl/` — auth login/whoami/logout, sites
  list/get/create, deploy, snapshots list, logs tail.

## Where surfaces live

| Surface | Path |
|---------|------|
| Worker routes | `src/routes/public_api.ts` |
| Token service | `src/services/api_tokens.ts` |
| D1 migration | `migrations/0515_public_api.sql` (api_tokens + api_token_usage) |
| Angular component | `frontend/src/app/pages/admin/sections/api-tokens.component.ts` |
| TypeScript SDK | `packages/sdk/` (`@projectsites/sdk`) |
| CLI | `packages/psctl/` (`psctl`) |

## Known incident

Commit `6d31156` fixed a production outage caused by `v1.use('*', ...)` matching
the marketing homepage. Always scope v1 middleware to `/v1/*`, not `*`.

## Flag key

`public_api_v1` — default off (`enabled=0`). When off, all `/v1/*` requests
return `503 { "error": "feature_disabled" }`.

## Tests

| Suite | Count | Files |
|-------|-------|-------|
| E2E | 19 tests | `e2e/public-api/public-api.spec.ts` |
| E2E fortress happy | 7 tests | `e2e/_fortress/public-api/happy-path.spec.ts` |
| E2E fortress adversarial | 8 tests | `e2e/_fortress/public-api/adversarial.spec.ts` |
| Unit | **0** | DRIFT — `src/__tests__/api_tokens.test.ts` missing |

## Drift notes

- **No unit tests** — needs `src/__tests__/api_tokens.test.ts` covering
  `createToken`, `validateToken`, `revokeToken`, and scope enforcement.
- `last_used_at` update is fire-and-forget via `ctx.waitUntil()` — this means
  it may not persist on low-traffic Workers. Consider a Queues-based approach.
- Rate limiting on `/v1/*` endpoints is not yet tier-aware (uses the global
  `/api/ai/*` RL bucket; needs a dedicated token-bucket per psk_ token).

## How to enable for testing

```bash
curl -X POST https://projectsites.dev/api/super-admin/feature-flags/public_api_v1/override \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -d '{"org_id":"<your_org>","enabled":1}'
```

## psctl quick start

```bash
npx psctl auth login
npx psctl sites list
npx psctl sites deploy <site-id> ./dist/
```

## Removal

See `removalNotes` in `feature.manifest.ts`.
