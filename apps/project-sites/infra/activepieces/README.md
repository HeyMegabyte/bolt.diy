# Activepieces — ProjectSites Automation Hub

**URL:** https://automation.projectsites.dev  
**Deployed:** 2026-06-30  
**Hosting:** Fly.io (`projectsites-activepieces`)  
**Edition:** Community Edition (CE)

## Architecture

```
Client → Cloudflare DNS (automation.projectsites.dev)
      → CNAME 56k39wn.projectsites-activepieces.fly.dev
      → Fly.io edge proxy
      → Fly machine (iad, shared-cpu-2x, 4GB)
      → Activepieces (WORKER_AND_APP, port 80)
        ├── Neon Postgres (projectsites_activepieces on Listmonk project)
        └── Upstash Redis (projectsites-activepieces, us-east-1)
```

## Why Fly.io, not Cloudflare Workers Containers

CF Containers attempted first (`activepieces/activepieces:latest`, ~500MB image). The container cold-start + Activepieces DB migration + Redis connection + piece sync startup exceeded CF Container's practical timeout. After 5+ minutes of timeouts on every request, pivoted to Fly.io per the hosting priority order.

The `worker.ts` and `wrangler.toml` in this directory were refactored from a Container DO to a thin CF Worker proxy, but then eliminated entirely when DNS was pointed directly to Fly (CNAME, no CF proxy). If CF proxy is desired later, redeploy the thin-proxy Worker and flip the DNS to `proxied: true`.

## DNS

| Type | Name | Content | Proxied |
|------|------|---------|---------|
| CNAME | `automation.projectsites.dev` | `56k39wn.projectsites-activepieces.fly.dev` | No |
| CNAME | `_acme-challenge.automation.projectsites.dev` | `automation.projectsites.dev.56k39wn.flydns.net.` | No |
| TXT | `_fly-ownership.automation.projectsites.dev` | `app-56k39wn` | No |

## Database

- **Provider:** Neon Postgres
- **Project:** Listmonk (`jolly-pine-24431114`)
- **Branch:** `br-cool-term-aifohvg9` (production)
- **Database:** `projectsites_activepieces`
- **Host:** `ep-round-wildflower-aigybxdk-pooler.c-4.us-east-1.aws.neon.tech`
- **SSL:** Required (`sslmode=require`)

## Redis

- **Provider:** Upstash Redis
- **Database:** `projectsites-activepieces` (`3eb65767-8f18-43da-9a83-7f5a71039ba9`)
- **Endpoint:** `harmless-sunbeam-155558.upstash.io:6379`
- **TLS:** Enabled

## Environment Variables

### Required (set as Fly secrets)

| Variable | Purpose |
|----------|---------|
| `AP_ENCRYPTION_KEY` | 32-char hex — encrypts connections |
| `AP_JWT_SECRET` | 64-char hex — signs JWT tokens |
| `AP_POSTGRES_HOST` | Neon pooler hostname |
| `AP_POSTGRES_PORT` | `5432` |
| `AP_POSTGRES_DATABASE` | `projectsites_activepieces` |
| `AP_POSTGRES_USERNAME` | `neondb_owner` |
| `AP_POSTGRES_PASSWORD` | Neon database password |
| `AP_REDIS_HOST` | Upstash endpoint |
| `AP_REDIS_PORT` | `6379` |
| `AP_REDIS_PASSWORD` | Upstash password |

### Non-secret (in fly.toml `[env]`)

| Variable | Value |
|----------|-------|
| `AP_EDITION` | `ce` |
| `AP_ENVIRONMENT` | `prod` |
| `AP_FRONTEND_URL` | `https://automation.projectsites.dev` |
| `AP_WEBHOOK_URL` | `https://automation.projectsites.dev` |
| `AP_CONTAINER_TYPE` | `WORKER_AND_APP` |
| `AP_DB_TYPE` | `POSTGRES` |
| `AP_POSTGRES_USE_SSL` | `true` |
| `AP_REDIS_TYPE` | `STANDALONE` |
| `AP_REDIS_USE_SSL` | `true` |
| `AP_WORKER_CONCURRENCY` | `1` |
| `AP_DEFAULT_CONCURRENT_JOBS_LIMIT` | `5` |
| `AP_FLOW_TIMEOUT_SECONDS` | `600` |
| `AP_TRIGGER_TIMEOUT_SECONDS` | `60` |
| `AP_PROJECT_RATE_LIMITER_ENABLED` | `true` |
| `AP_NETWORK_MODE` | `STRICT` |
| `AP_TELEMETRY_ENABLED` | `false` |
| `AP_EXECUTION_MODE` | `UNSANDBOXED` |
| `AP_PIECES_SYNC_MODE` | `OFFICIAL_AUTO` |

## Healthcheck

```bash
curl -sS -o /dev/null -w '%{http_code}' https://automation.projectsites.dev/
# Expected: 200
```

## Smoke Test

```bash
bash apps/project-sites/infra/activepieces/smoke.sh
```

## Admin Account

Initial admin account auto-provisioned during first deploy (2026-06-30). The email is `brian@megabyte.space`.

The password is **not committed to this repo**. It is stored in:
- **Bitwarden** → search "Activepieces Admin"
- **Neon** → `user_identity` table (bcrypt-hashed, `projectsites_activepieces` database)
- **Fly secrets** → `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET`, and all infra credentials

To reset the admin password: sign in, or update the bcrypt hash in `user_identity.password` via Neon SQL.

## Rollback

```bash
flyctl deploy -a projectsites-activepieces --image activepieces/activepieces:<previous-tag>
```

Or deploy from local state:
```bash
cd apps/project-sites/infra/activepieces
flyctl deploy -a projectsites-activepieces
```

## Upgrade

```bash
cd apps/project-sites/infra/activepieces
# Update fly.toml [build] image tag if pinning a version
flyctl deploy -a projectsites-activepieces
```

## Backup/Restore

- **Neon:** Point-in-time recovery via Neon Console or `wrangler d1 time-travel restore` equivalent via Neon API. Branching available.
- **Upstash:** Daily backups enabled. Restore via Upstash Console.
- **Fly volumes:** Not used (stateless app — all state in Neon + Upstash).

## Next Steps (from deployment brief)

1. **Split APP + WORKER containers** — change `AP_CONTAINER_TYPE` to `APP` on one machine and `WORKER` on another. Scale workers independently.
2. **R2 file storage** — configure `AP_FILE_STORAGE_LOCATION=S3` + R2 credentials when logs/files grow.
3. **SMTP** — configure SES SMTP for password reset/invitation emails.
4. **Nango OAuth** — wire ProjectSites OAuth Hub for piece connections.
5. **Observability** — add synthetic checks for login page, worker queue health.
6. **ProjectSites starter templates** — create flow templates in Activepieces for common automations.

## Files

```
apps/project-sites/infra/activepieces/
├── Dockerfile              # Base image (for CF Container attempt — not used by Fly)
├── fly.toml                # Fly.io app configuration
├── wrangler.toml           # CF Worker proxy config (not deployed; DNS direct to Fly)
├── worker.ts               # CF Worker proxy (not deployed; DNS direct to Fly)
└── smoke.sh                # Smoke test script
```

## Provisioning Commands (recreate from scratch)

```bash
# Neon database (already exists — this is the create command)
# Created via Neon API: database projectsites_activepieces on jolly-pine-24431114/br-cool-term-aifohvg9

# Upstash Redis
# Created via Upstash MCP: projectsites-activepieces, us-east-1, TLS enabled

# Fly app
flyctl apps create projectsites-activepieces --org personal
flyctl secrets set AP_ENCRYPTION_KEY=... AP_JWT_SECRET=... AP_POSTGRES_HOST=... ... -a projectsites-activepieces
flyctl certs add automation.projectsites.dev -a projectsites-activepieces
flyctl deploy -a projectsites-activepieces

# DNS (Cloudflare API)
# CNAME automation → 56k39wn.projectsites-activepieces.fly.dev (not proxied)
# CNAME _acme-challenge.automation → automation.projectsites.dev.56k39wn.flydns.net. (not proxied)
# TXT _fly-ownership.automation → app-56k39wn
```
