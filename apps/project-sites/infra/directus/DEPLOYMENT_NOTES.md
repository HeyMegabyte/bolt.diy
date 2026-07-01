# Directus Deployment Notes — directus.projectsites.dev

**Date:** 2026-06-30
**Operator:** Brian Zalewski
**Directus version:** 12.0.2 (pinned)
**Hosting platform:** Cloudflare Workers Containers
**Subdomain:** directus.projectsites.dev

## Infrastructure decisions

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Compute | Cloudflare Workers Containers (standard-1) | CF-native first; no external container host needed |
| Database | Neon Postgres (shared Listmonk project `jolly-pine-24431114`) | `neon-database-conservation`: added as `directus` database, not a new project |
| Database role | `directus` (dedicated) | Least privilege; owns the `directus` DB |
| Redis | Upstash Redis (`projectsites-directus`, us-east-1) | Cache/session store for Directus |
| Storage | Cloudflare R2 (`projectsites-directus-assets`, S3-compatible) | Ephemeral container disk; R2 for persistent uploads |
| Worker proxy | `projectsites-directus` (container DO) | Routes directus.projectsites.dev to container on port 8055 |

## Fallback attempts

None — Cloudflare Containers worked on first successful deploy (after fixing DB permissions + bootstrapping).

## Configuration

- **PUBLIC_URL:** https://directus.projectsites.dev
- **DB_CLIENT:** pg (Neon Postgres pooled connection)
- **CACHE_STORE:** redis (Upstash)
- **STORAGE_LOCATIONS:** r2 (S3-compatible)
- **Image:** `directus/directus:12.0.2` (Alpine-based, amd64)

## Secrets

All secrets are set via `wrangler secret put` on the `projectsites-directus` Worker:
- SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
- DB_CONNECTION_STRING (Neon pooled URL)
- REDIS (rediss://...)
- STORAGE_R2_KEY, STORAGE_R2_SECRET

## DNS

- Zone route: `directus.projectsites.dev/*` → `projectsites-directus`
- Created via Cloudflare API (`POST /zones/:id/workers/routes`)
- workers.dev fallback: `projectsites-directus.manhattan.workers.dev`

## Smoke tests (verified 2026-06-30)

```
curl -I https://directus.projectsites.dev/          → HTTP 200
curl https://directus.projectsites.dev/server/ping   → pong
curl -I https://directus.projectsites.dev/admin      → HTTP 200
curl -I https://projectsites-directus.manhattan.workers.dev/ → HTTP 200
```

Browser: opens Directus login page at https://directus.projectsites.dev/

## Known limitations

1. **R2 S3 credentials are placeholders** — generate real ones at https://dash.cloudflare.com/84fa0d1b16ff8086dd958c468ce7fd59/r2/api-tokens and run `bash update-r2-secrets.sh <KEY> <SECRET>`. Until then, uploads use ephemeral container-local storage.
2. **Cold start ~15-30s** — container hibernates after 30min idle. First request after idle takes time to start.
3. **Single instance** — no horizontal scaling. Fine for admin/internal use.
4. **`/server/health` returns 403** — expected; health checks deeper dependencies that may not all be configured.

## Security

- **Rate limiting** active on Directus admin login: 5 req/10s per IP (merged into zone-wide auth rate limit rule `18463a1095f04e07aca2cd7b941be502`).
- **CF Access** recommended for production: add an Access policy on `directus.projectsites.dev/admin/*` for an extra auth layer before Directus login. Configure at https://one.dash.cloudflare.com/84fa0d1b16ff8086dd958c468ce7fd59/access/apps.

## Backups

- **Neon PITR**: 30-day point-in-time recovery on the `jolly-pine-24431114` project (branch `br-cool-term-aifohvg9`). Restore via `wrangler d1 time-travel restore` or Neon console.
- **Manual pg_dump**: `pg_dump "postgresql://directus:..." > directus-backup-$(date +%Y%m%d).sql`
- **Schema snapshots**: `npx directus schema snapshot ./snapshot.yaml` (store in `snapshots/` dir)

## Files

- `apps/project-sites/infra/directus/worker.ts` — Worker entry point
- `apps/project-sites/infra/directus/Dockerfile` — Container image (pinned 12.0.2)
- `apps/project-sites/infra/directus/wrangler.toml` — CF config
- `apps/project-sites/infra/directus/deploy.sh` — Deploy script
- `apps/project-sites/infra/directus/DIRECTUS_RUNBOOK.md` — Operations runbook
