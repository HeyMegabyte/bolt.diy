# Unkey — api.projectsites.dev (Cloudflare Workers Containers)

Self-hosted [Unkey](https://github.com/unkeyed/unkey) (API key management, AGPL) for projectsites
at **api.projectsites.dev**, on **Cloudflare Workers Containers** (cloudflare-lock-in-is-leverage).
AGPL stays isolated behind the HTTP boundary — own container/subdomain, zero code import
(agpl-isolation-via-http-boundary). One published Go-binary image; MySQL + Redis only.

## Data plane (provisioned 2026-06-29)

| Service | Provider | Resource | Secret (get-secret) |
|---|---|---|---|
| MySQL | TiDB Serverless | cluster `unkey` `10078693785967806120` (eu-central-1), db `unkey` | `UNKEY_DATABASE_PRIMARY` (Go DSN, `…?parseTime=true&tls=true`) |
| Redis | Upstash | `unkey` (eu-central-1, TLS) | `UNKEY_REDIS_URL` (rediss://) |
| Root key | self-gen | `openssl rand -hex 32` | `UNKEY_ROOT_KEY` |

ClickHouse (analytics) + Vault (encryption-at-rest) are **optional** and omitted for v1 — the
Railway template + `svc/api/config.go` confirm MySQL+Redis are the only required deps.

## Architecture (one Worker, ONE Container DO)

```
api.projectsites.dev ─▶ Worker projectsites-unkey (worker.ts) ─▶ Unkey container (:7070)
                                                                  │ ENTRYPOINT /unkey runs the
                        cron */3 ─▶ scheduled() /v2/liveness ─────┘ Go API; talks to TiDB + Upstash
```

- `image = unkeyed/unkey:v2.0.49` (Dockerfile pins `--platform=linux/amd64` per cf-containers-native-amd64-only).
- Server binds `UNKEY_HTTP_PORT` (default 7070) on 0.0.0.0; CF health-checks 7070.
- **Routing:** explicit `api.projectsites.dev/*` route BEATS the main worker's `*.projectsites.dev/*`
  wildcard (custom_domain would lose — validated mail.*/pm.* pattern). DNS via proxied `*` AAAA + wildcard cert.
- Migrations run on the container's first boot against the TiDB `unkey` db (db created 2026-06-29).

## Deploy

Push to `apps/project-sites/infra/unkey/**` → `.github/workflows/unkey-deploy.yaml` (amd64 runner
has Docker) builds the image + deploys + sets secrets from GitHub repo secrets + re-deploys + verifies
`GET https://api.projectsites.dev/v2/liveness → 200`. GitHub repo secrets `UNKEY_DATABASE_PRIMARY`,
`UNKEY_REDIS_URL`, `UNKEY_ROOT_KEY` are synced from get-secret.

## Verify

- `curl https://api.projectsites.dev/v2/liveness` → 200.
- Create a key via the root key: `POST /v2/keys.createKey` with `Authorization: Bearer $UNKEY_ROOT_KEY`.

## Notes / risks (first deploy)

- Distroless image = no shell/Caddy, so container stdout isn't curl-inspectable (unlike Plane). If
  the container never binds 7070, debug via `wrangler tail` + reasoning (most likely: Redis `rediss://`
  TLS parse, or Vault/ClickHouse turning out to be required → add the env).
- If the Go redis client rejects `rediss://`, switch `UNKEY_REDIS_URL` to `redis://…?tls=true` form.
- New virtual MySQL per app comes from TiDB Serverless (tidb-serverless-default-mysql memory).
