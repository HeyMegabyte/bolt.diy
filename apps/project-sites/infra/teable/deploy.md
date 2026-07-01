# Teable Deployment — teable.projectsites.dev

> No-code Postgres database (Airtable alternative) on Cloudflare Workers Containers
> with Neon Postgres, Upstash Redis, and Cloudflare R2.

## Architecture

```
Browser → CF Edge → CF Worker (projectsites-teable, Container DO proxy)
                  → CF Container (ghcr.io/teableio/teable:latest, standard-4, port 3000)
                  → Neon Postgres (projectsites_teable) + Upstash Redis ×2 + R2 (pending)
```

**Runtime:** Cloudflare Workers Containers (standard-4: 4 vCPU, 12GB, 20GB disk).
**Why CF Containers (not Fly.io):** The initial deployment failed because of two missing
env vars: `DATABASE_URL` must include explicit `:5432` port (Neon pooled URL omits it),
and S3 storage requires access keys. With `BACKEND_STORAGE_PROVIDER=local` and the
corrected DB URL, the container starts cleanly in ~60-90s cold boot.

## Resources

| Resource | Name | Provider |
|----------|------|----------|
| App runtime | projectsites-teable Container DO | Cloudflare (standard-4) |
| Postgres | projectsites_teable on jolly-pine-24431114 | Neon (us-east-1, PG17) |
| Redis cache | projectsites-teable-cache | Upstash (us-east-1) |
| Redis perf | projectsites-teable-perf | Upstash (us-east-1) |
| R2 public | projectsites-teable-public | Cloudflare R2 |
| R2 private | projectsites-teable-private | Cloudflare R2 |
| Worker proxy | projectsites-teable | Cloudflare Workers |
| DNS | teable.projectsites.dev (Worker route) | Cloudflare DNS |

## Secrets (CF Worker)

| Secret | Purpose |
|--------|---------|
| SECRET_KEY | JWT/session encryption (openssl rand -base64 48) |
| DATABASE_URL | Neon Postgres direct URL with explicit :5432 port |
| BACKEND_CACHE_REDIS_URI | Upstash Redis cache (rediss://...) |
| BACKEND_PERFORMANCE_CACHE | Upstash Redis perf cache (rediss://...) |

## Env vars (injected by Container DO)

| Var | Value |
|-----|-------|
| PORT / SOCKET_PORT | 3000 |
| PUBLIC_ORIGIN | https://teable.projectsites.dev |
| NEXT_ENV_IMAGES_ALL_REMOTE | true |
| BACKEND_CACHE_PROVIDER | redis |
| BACKEND_STORAGE_PROVIDER | local (switch to s3 after R2 token provisioning) |
| STORAGE_PREFIX | https://teable-assets.projectsites.dev |

## Deploy

```bash
cd apps/project-sites/infra/teable

# Set secrets (one-time)
printf '%s' "<value>" | npx wrangler secret put SECRET_KEY --name projectsites-teable
printf '%s' "<value>" | npx wrangler secret put DATABASE_URL --name projectsites-teable
printf '%s' "<value>" | npx wrangler secret put BACKEND_CACHE_REDIS_URI --name projectsites-teable
printf '%s' "<value>" | npx wrangler secret put BACKEND_PERFORMANCE_CACHE --name projectsites-teable

# Deploy Worker + Container
npx wrangler deploy
```

## Verify

```bash
# Health
curl https://teable.projectsites.dev/_health
# → {"status":"ok","service":"teable","runtime":"cf-containers"}

# Readiness
curl https://teable.projectsites.dev/_ready
# → {"status":"ready","http_status":200}

# Login page
curl -sS -o /dev/null -w "%{http_code}" https://teable.projectsites.dev/
# → 200

# Full check
bash check-teable.sh
```

## Rollback

```bash
# Worker rollback
npx wrangler rollback --name projectsites-teable

# Container-specific: revert image in wrangler.toml, redeploy
```

## Backup / Restore

- **Neon**: PITR via Neon console (30-day history on paid plans)
- **Redis**: Upstash backups on paid tier
- **R2**: Versioning enabled on buckets

## Upgrade Teable version

```bash
# Pin to a digest for reproducible builds:
# docker pull ghcr.io/teableio/teable:latest
# docker inspect ghcr.io/teableio/teable:latest --format='{{.RepoDigests}}'

# Update Dockerfile ARG TEABLE_VERSION, bump CACHEBUST, redeploy
npx wrangler deploy
```

## Gotchas

1. **DATABASE_URL must include explicit port.** Neon's pooled URL omits `:5432` —
   Teable's `parseDsn()` requires it. Use `...neon.tech:5432/dbname?sslmode=require`.
2. **DATABASE_URL AND PRISMA_DATABASE_URL both needed.** The NestJS backend parses
   `DATABASE_URL` directly; Prisma migrations use `PRISMA_DATABASE_URL`.
3. **S3 storage requires access keys.** If `BACKEND_STORAGE_PROVIDER=s3` is set
   without keys, the NestJS bootstrap crashes. Use `local` until R2 tokens are
   provisioned.
4. **Cold boot ~60-90s.** DB migrations + NestJS bootstrap + Next.js startup.
   The keep-warm cron (`*/15 * * * *`) prevents idle hibernation.
5. **Image is 3.45GB.** The base image is large; CF Containers handle it but
   docker push/pull is slow. Pin to a digest for reproducible builds.

## Pending

- [ ] R2 S3 API tokens — provision via CF dashboard → set `BACKEND_STORAGE_PROVIDER=s3`
- [ ] R2 CORS for `teable-assets.projectsites.dev` custom domain
- [ ] Email (SES SMTP) — set `BACKEND_MAIL_*` env vars in worker.ts
- [ ] OIDC/OAuth — configure `BACKEND_GOOGLE_CLIENT_*` or Logto
- [ ] Pin Docker image to specific digest

## History

- **2026-07-01 v2**: CF Containers working after fixing DATABASE_URL port + switching to local storage
- **2026-07-01 v1**: Initial attempt failed (CF Containers), fell back to Fly.io successfully
- **2026-06-30**: Infrastructure provisioned (Neon, Upstash, R2 buckets)
