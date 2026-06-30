# AnythingLLM Deployment — anything.projectsites.dev

**Status:** Deployed · **Provider:** Fly.io + CF Workers proxy · **DB:** Neon PostgreSQL + PGVector

## Quick Reference

| Field | Value |
|---|---|
| URL | `https://anything.projectsites.dev` |
| Provider | Fly.io (ewr) |
| Image | `mintplexlabs/anythingllm:pg-1.15.0` |
| Port | 3001 |
| Database | Neon `anythingllm` on `jolly-pine-24431114` (Listmonk project) |
| Vector DB | PGVector (Neon PostgreSQL) |
| Storage | Fly.io persistent volume (`anythingllm_storage`, 10GB, ewr) |
| Proxy | CF Worker (`projectsites-anythingllm-v2`) — reverse proxy to Fly |
| DNS | `anything.projectsites.dev` → CF proxy → Worker → Fly.io app |

## Architecture

```
anything.projectsites.dev
  → CF TLS termination
  → proxy worker (projectsites-anythingllm-v2) — reverse proxy to Fly
  → projectsites-anythingllm.fly.dev:3001
  → AnythingLLM container
    → Neon PostgreSQL (anythingllm DB) — users, workspaces, chats, settings
    → PGVector (same Neon DB) — embeddings, vector search
    → Fly persistent volume (/app/server/storage) — uploaded documents
```

## Why Fly.io (not CF Containers)

CF Containers was attempted first (`standard-2`: 1 vCPU, 6GB RAM, 12GB disk). The container image pulled and the container application became healthy, but the Durable Object consistently failed to connect with "The container is not running, consider calling start()". This is a CF Containers beta platform issue — the DO and container lifecycle get out of sync for this particular ~1GB image. After ~90min of debugging across multiple approaches (explicit start(), enableInternet, fresh redeploy, instance type upgrade from basic→standard-2), the fallback to Fly.io succeeded in minutes.

Fly.io gives us:
- Persistent volume (documents survive restarts)
- Direct PostgreSQL connectivity
- Proven platform stability
- Auto-start on first request, auto-stop on idle

## Secrets (via `flyctl secrets set`)

| Secret | Purpose |
|---|---|
| `DATABASE_URL` | Main app PostgreSQL connection |
| `PGVECTOR_CONNECTION_STRING` | Vector database connection (same Neon DB) |
| `JWT_SECRET` | Session signing (≥12 chars) |
| `SIG_KEY` | Signing passphrase (≥32 chars) |
| `SIG_SALT` | Signing salt (≥32 chars) |
| `AUTH_TOKEN` | Application password for API access |

## File Storage — R2 Question

AnythingLLM uses `STORAGE_DIR` (`/app/server/storage`) for uploaded documents. On Fly.io, this is backed by a persistent volume (10GB) that survives restarts and redeploys.

**R2 is NOT used for document storage** because AnythingLLM does not support S3-compatible backends natively. The filesystem is the only storage interface. Options for R2-backed persistence if needed:
- **Init/download + periodic upload**: Sync documents from R2 on container start, sync changed files back periodically. Risk: files uploaded between sync and crash are lost.
- **rclone/s3fs FUSE mount**: Requires FUSE kernel support in container. Unreliable on Fly's firecracker VMs.
- **Fork AnythingLLM**: Add S3-compatible storage driver. Most robust but requires maintenance.

The persistent Fly volume is the practical solution for production document storage.

## Startup

```bash
# Deploy proxy worker (CF)
cd apps/project-sites/infra/anythingllm
npx wrangler deploy

# Deploy app (Fly)
cd fly
flyctl deploy --ha=false
```

## Health Check

```bash
bash scripts/smoke/anythingllm.sh
```

Asserts: HTTP 200 + login/setup UI markers + security headers.

## Upgrade Strategy

1. Update `fly.toml` image tag: `mintplexlabs/anythingllm:pg-1.16.0`
2. `flyctl deploy --ha=false`
3. Smoke test
4. If broken: revert tag + redeploy

## Rollback

```bash
# Fly rollback
flyctl releases -a projectsites-anythingllm
flyctl deploy --image mintplexlabs/anythingllm:pg-1.15.0 -a projectsites-anythingllm

# Worker rollback
cd apps/project-sites/infra/anythingllm
npx wrangler rollback
```

## Backup Strategy

Neon PostgreSQL: automatic PITR. Fly volume: automatic scheduled snapshots (5 retained). Manual DB dump:

```bash
pg_dump "$DATABASE_URL" > anythingllm-$(date +%Y%m%d).sql
```

## Restore

```bash
psql "$DATABASE_URL" < anythingllm-YYYYMMDD.sql
```

## Known Limitations

- **Machine auto-stop/start**: With `min_machines_running = 0`, first request after idle triggers a cold start (~15-30s).
- **Web scraping**: `--no-sandbox` and `--disable-setuid-sandbox` may not work fully on Fly's firecracker VMs.
- **Custom domain TLS**: Served via CF (not Fly) since CF Workers manages `*.projectsites.dev` DNS.
- **Chat history visibility**: Not restricted by default. Set `DISABLE_VIEW_CHAT_HISTORY=1` for multi-user mode.

## Files

| File | Purpose |
|---|---|
| `infra/anythingllm/worker.ts` | CF reverse proxy worker |
| `infra/anythingllm/wrangler.toml` | Proxy worker config |
| `infra/anythingllm/fly/fly.toml` | Fly.io app config |
| `infra/anythingllm/deploy.sh` | Deployment script |
| `scripts/smoke/anythingllm.sh` | Smoke test |
| `docs/deployments/anythingllm.md` | This document |
