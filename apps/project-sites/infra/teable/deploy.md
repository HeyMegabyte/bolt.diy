# Teable Deployment — teable.projectsites.dev

> No-code Postgres database (Airtable alternative) deployed on Fly.io with Neon Postgres, Upstash Redis, and Cloudflare R2.

## Architecture

```
Browser → CF Edge (teable.projectsites.dev)
         → CF Worker (projectsites-teable — Fly proxy + health checks)
         → Fly.io (projectsites-teable.fly.dev, ewr, shared-cpu-4x, 4GB)
         → Neon Postgres (projectsites_teable) + Upstash Redis ×2 + R2 (pending)
```

**Why Fly.io not CF Containers:** The 3.45GB Teable Docker image is too large for CF Containers (beta). The container consistently crashed before port 3000 opened. Fly.io is the fallback per hosting priority.

## Resources

| Resource | Name | Provider |
|----------|------|----------|
| App runtime | projectsites-teable | Fly.io (ewr, shared-cpu-4x, 4GB) |
| Postgres | projectsites_teable on jolly-pine-24431114 | Neon (us-east-1) |
| Redis cache | projectsites-teable-cache | Upstash (us-east-1) |
| Redis perf | projectsites-teable-perf | Upstash (us-east-1) |
| R2 public | projectsites-teable-public | Cloudflare |
| R2 private | projectsites-teable-private | Cloudflare |
| Worker proxy | projectsites-teable | Cloudflare Workers |
| DNS | teable.projectsites.dev → Fly CNAME | Cloudflare DNS |

## Secrets

| Secret | Where | Purpose |
|--------|-------|---------|
| DATABASE_URL | Fly + CF Worker secrets | Neon Postgres (direct, port 5432) |
| PRISMA_DATABASE_URL | Fly secrets | Prisma migrations |
| SECRET_KEY | Fly secrets | JWT/session encryption |
| BACKEND_CACHE_REDIS_URI | Fly + CF Worker secrets | Upstash Redis cache |
| BACKEND_PERFORMANCE_CACHE | Fly + CF Worker secrets | Upstash Redis perf cache |

## Env vars (fly.toml)

- `PORT=3000`, `SOCKET_PORT=3000`
- `PUBLIC_ORIGIN=https://teable.projectsites.dev`
- `NEXT_ENV_IMAGES_ALL_REMOTE=true`
- `BACKEND_CACHE_PROVIDER=redis`
- `BACKEND_STORAGE_PROVIDER=local` (S3/R2 pending R2 token provisioning)

## Deploy

```bash
cd apps/project-sites/infra/teable

# Deploy Fly app
flyctl deploy --app projectsites-teable --ha=false

# Deploy CF Worker proxy
npx wrangler deploy
```

## Verify

```bash
# Health
curl https://teable.projectsites.dev/_health
# → {"status":"ok","service":"teable","runtime":"fly.io"}

# Readiness
curl https://teable.projectsites.dev/_ready
# → {"status":"ready","http_status":200}

# Login page
curl -sS -o /dev/null -w "%{http_code}" https://teable.projectsites.dev/
# → 200

# Full check script
bash scripts/check-teable.sh
```

## Rollback

```bash
# Fly rollback
flyctl deploy --app projectsites-teable --image ghcr.io/teableio/teable:<previous-tag>

# Worker rollback
npx wrangler rollback --name projectsites-teable
```

## Backup / Restore

- **Neon**: Point-in-time recovery via Neon console (30-day history on paid plans)
- **Restore**: Create a new Neon branch from a past point, update `DATABASE_URL` in Fly secrets
- **Redis**: Upstash backups enabled on paid tier — restore via Upstash console

## Upgrade

```bash
# Pin to a specific version after first successful deploy
# Current: ghcr.io/teableio/teable:latest (2026-06-30 build)

# To upgrade:
flyctl deploy --app projectsites-teable \
  --image ghcr.io/teableio/teable:<new-version>
```

## Pending

- [ ] R2 S3 API tokens — provision via CF dashboard, set `BACKEND_STORAGE_PROVIDER=s3` env vars
- [ ] R2 CORS for `teable-assets.projectsites.dev` custom domain
- [ ] Email (SES SMTP) — set `BACKEND_MAIL_*` env vars
- [ ] OIDC/OAuth — configure `BACKEND_GOOGLE_CLIENT_*` or Logto
- [ ] Add a Fly persistent volume for `/app/.assets` (local storage is ephemeral)
- [ ] Volume for `/app/.temporary`
- [ ] Pin Docker image to specific digest after stable operation

## Acceptance checklist

- [x] teable.projectsites.dev resolves through Cloudflare
- [x] Teable running on Fly.io (CF Containers fallback documented)
- [x] Neon Postgres configured and reachable
- [x] Upstash Redis ×2 configured and reachable
- [x] R2 public/private buckets created
- [x] PUBLIC_ORIGIN = https://teable.projectsites.dev
- [x] SECRET_KEY stored as secret
- [x] Login page returns HTTP 200
- [x] /_health and /_ready pass
- [x] Container logs show no DB, Redis, or migration errors
- [x] Storage: local (ephemeral) — S3/R2 pending API token
- [ ] Cloudflare Access not blocking login (verified — no Access present)
- [ ] R2 public bucket CORS configured
- [ ] docs/deploy/teable.md created
- [ ] scripts/check-teable.sh exists and passes
