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

## Status — ✅ LIVE (2026-06-29)

`GET https://api.projectsites.dev/v2/liveness` → 200 `{"data":{"message":"we're cooking"}}` (8/8).
Backed by TiDB MySQL + Upstash Redis. WAF skip for `api.projectsites.dev` added to the zone skip rule.

### Resolved gotchas (the 7-iteration arc)
- **Image is on GHCR, not Docker Hub** (`docker.io/unkeyed/unkey` 401s) → `ghcr.io/unkeyed/unkey:v2.0.49`.
- **Entrypoint is the unkey CLI** — bare run prints help + exits → no :7070 → Worker 1101. Fix: `CMD ["run","api"]`.
- **No baked config** — needs `unkey.toml` (`UNKEY_CONFIG`, `os.ExpandEnv` fills `${UNKEY_*}`). Provided + COPY'd.
- **Distroless = blind on CF** — decisive debug was a LOCAL `docker run … run api` (Docker was up locally), which revealed the CLI-help behavior. Always try local `docker run` for a distroless boot error.
- **WAF** — programmatic POSTs hit the managed challenge; added `api.projectsites.dev` to the zone skip rule.

### Remaining setup (NOT a launch blocker)
- **Root-key bootstrap**: `UNKEY_ROOT_KEY` is not auto-seeded. `POST /v2/apis.createApi` with it → 500
  "could not load the requested key" (schema migrated, no workspace/root-key rows). To ISSUE keys,
  bootstrap a workspace + root key (Unkey dashboard, or a DB seed). The API itself is fully up.
- New virtual MySQL per app comes from TiDB Serverless (tidb-serverless-default-mysql memory).
