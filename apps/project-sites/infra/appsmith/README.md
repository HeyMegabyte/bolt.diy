# Appsmith — Internal Tools Builder for ProjectSites.dev

Deploy Appsmith (low-code internal tool builder) to `appsmith.projectsites.dev`.

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-30 | Attempted Fly.io first | CF Containers rejected — Appsmith bundles embedded MongoDB/PostgreSQL/Redis that need durable storage, not ephemeral CF Container disk |
| 2026-06-30 | Fly.io Firecracker VMs fail | Appsmith's all-in-one image crashes on Firecracker (exit_code=2, ~24-270s lifespan). Tested: EE v2.1.1 + CE v2.1, iad + ewr, 4GB shared + 8GB performance, with/without /dev/shm |
| 2026-06-30 | Railway fallback | Railway runs standard Docker (not Firecracker) |
| 2026-06-30 | Worker proxy for custom domain | CF wildcard route catches `*.projectsites.dev` → Worker proxy added to forward `appsmith.projectsites.dev` → Railway |

## Architecture (as-built)

```
appsmith.projectsites.dev (Cloudflare DNS, proxied)
  → CF Worker (project-sites) — proxy middleware, no-cache
  → https://projectsitesdev-production.up.railway.app
  → Railway container: appsmith/appsmith-ce:v2.1, 8GB RAM
  → Persistent volume: /appsmith-stacks (Railway)
```

### Runtime
- **Railway** (standard Docker, 8GB RAM)
- **Cloudflare Worker** (proxy + WAF + TLS termination)
- **Image**: `appsmith/appsmith-ce:v2.1` (pinned)
- 2 image variants (CE v2.1, EE v2.1.1)
- 2 regions (iad, ewr)
- 2 VM tiers (shared-2 4GB, performance-2 8GB)
- With and without /dev/shm mount

### Why Railway
Railway runs standard Docker Engine — no Firecracker kernel limitations.
The Appsmith image works unmodified on standard Docker hosts.

## Quick Start

Appsmith is LIVE at `https://appsmith.projectsites.dev`.

### Worker Proxy
The CF Worker (`src/index.ts`) proxies `appsmith.projectsites.dev` → Railway.
Cache-bypassed at the Worker level. To update the Railway target, edit
the proxy middleware in `src/index.ts` and redeploy the Worker.

### Redeploy (Railway)
```bash
cd apps/project-sites/infra/appsmith
railway up --detach -y
```

### Redeploy (Worker proxy)
```bash
cd apps/project-sites
CLOUDFLARE_API_KEY=$(get-secret CLOUDFLARE_API_KEY) \
CLOUDFLARE_EMAIL=blzalewski@gmail.com \
npx wrangler deploy --env production
```

## Fly.io Config (preserved for reference)

The `fly.toml` is kept as `fly.toml.attempted` — it documents the configuration
that was tested and failed. Do NOT use for production. If Fly resolves the
Firecracker compatibility issue, this config can be revived.

## Architecture (target)

```
appsmith.projectsites.dev
  → Cloudflare DNS / TLS / WAF (proxied)
  → Railway container (standard Docker)
  → appsmith/appsmith-ce:v2.1 (or :v2.1.1 for EE)
  → Persistent volume for /appsmith-stacks
```

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Railway (standard Docker) |
| Storage | Railway volume (/appsmith-stacks) |
| DNS + TLS | Cloudflare proxied |
| Email | SES SMTP (optional) |
| Backups | Nightly tar.gz → R2 |

## Post-Bootstrap Hardening

1. Sign up with admin email at `https://appsmith.projectsites.dev`
2. Set `APPSMITH_SIGNUP_DISABLED=true` in Railway env vars
3. Set `APPSMITH_ADMIN_EMAILS=brian@megabyte.space`
4. Redeploy

## Secrets Reference

| Secret | Required | Purpose |
|--------|----------|---------|
| `APPSMITH_ENCRYPTION_PASSWORD` | Yes | Encrypts app credentials at rest |
| `APPSMITH_ENCRYPTION_SALT` | Yes | Encrypts app credentials at rest |
| `APPSMITH_SUPERVISOR_PASSWORD` | Yes | Initial admin password |
| `APPSMITH_SIGNUP_DISABLED` | After bootstrap | Lock down public signup |
| `APPSMITH_MAIL_*` | Optional | SMTP for invites/password reset |

## Observability

- Cloudflare Analytics at the edge
- Railway logs + metrics
- Appsmith internal audit logs

## Cost (Railway estimate)

| Resource | Monthly |
|----------|---------|
| Railway container (8 GB, 2 vCPU) | ~$40-60/mo |
| Railway volume (50 GB) | ~$15/mo |
| Cloudflare DNS + WAF | $0 (free tier) |
| **Total** | **~$55-75/mo** |

## Files

| File | Purpose |
|------|---------|
| `fly.toml.attempted` | Fly.io config (tested, not working — kept for reference) |
| `Dockerfile` | Wrapper with /dev/shm fix (tested, did not resolve Firecracker issue) |
| `.env.example` | Environment variable reference |
| `deploy.sh` | Deployment script (Railway) |
| `smoke.sh` | Smoke test (curl login page 200 check) |
| `backup.sh` | Backup script (tar.gz volume → R2) |
| `appsmith.smoke.spec.ts` | Playwright E2E smoke test |
