# Langflow @ langflow.projectsites.dev — Deployment Record

**Deployed:** 2026-07-01
**Platform:** Cloudflare Workers Containers
**Langflow Version:** 1.10.1
**Image Digest:** `sha256:bb52d9bc6f413e1a73235497c75cab334d05b7c3db0818515f54771b17376be5`

## Quick Status

| Check | Result |
|---|---|
| URL | `https://langflow.projectsites.dev/` |
| TLS | Valid (CF edge certificate) |
| HTTP 200 | ✅ |
| Login page renders | ✅ |
| Cold start | ~98s first request, ~150ms warm |
| Auto-login disabled | ✅ |

## Architecture

```
Browser → CF Edge → langflow.projectsites.dev/* route
                         ↓
              projectsites-langflow Worker
                         ↓
              LangflowContainerDO (Durable Object)
                         ↓
              Docker container (langflowai/langflow:1.10.1)
                         ↓ port 7860
              Langflow FastAPI + React frontend
                         ↓
              Neon Postgres (plain-heart-31877384 / br-dawn-cake-aj0g4r12 / neondb)
```

## Infrastructure

| Layer | Detail |
|---|---|
| **Compute** | CF Workers Container, `standard-2` (2 vCPU, 4 GiB) |
| **Container DO** | `LangflowContainerDO`, max 1 instance, 30m idle sleep |
| **Database** | Neon Postgres, project `plain-heart-31877384` (Langfuse shared), branch `br-dawn-cake-aj0g4r12`, db `neondb` |
| **Redis** | Not provisioned (single-worker mode; provision Upstash if scaling to multi-worker) |
| **Object Storage** | Not provisioned (R2 S3 attempted later via `AWS_ENDPOINT_URL_S3` + custom endpoint) |
| **DNS** | `langflow.projectsites.dev/*` — explicit route on projectsites.dev zone (beats main `*.projectsites.dev/*` wildcard) |

## Secrets (all set via `wrangler secret put`)

| Secret | Source |
|---|---|
| `LANGFLOW_SECRET_KEY` | `openssl rand -base64 32` |
| `LANGFLOW_SUPERUSER` | `admin` |
| `LANGFLOW_SUPERUSER_PASSWORD` | `openssl rand -base64 16` |
| `LANGFLOW_DATABASE_URL` | Neon connection string, `?sslmode=require` |
| `LANGFLOW_REDIS_QUEUE_URL` | (optional — Upstash Redis) |
| `LANGFLOW_STORAGE_*` | (optional — R2 S3 keys) |

## Deployment Commands

```bash
# Set secrets
cd apps/project-sites/infra/langflow
echo "<value>" | npx wrangler secret put LANGFLOW_SECRET_KEY --name projectsites-langflow
echo "<value>" | npx wrangler secret put LANGFLOW_SUPERUSER --name projectsites-langflow
echo "<value>" | npx wrangler secret put LANGFLOW_SUPERUSER_PASSWORD --name projectsites-langflow
echo "<value>" | npx wrangler secret put LANGFLOW_DATABASE_URL --name projectsites-langflow

# Deploy
npx wrangler deploy

# Verify
curl -sS -o /dev/null -w "%{http_code}\n" https://langflow.projectsites.dev/
```

## Rollback

```bash
# Rollback to previous version
npx wrangler rollback --name projectsites-langflow

# Or deploy a specific version
npx wrangler rollback <version-id> --name projectsites-langflow
```

## Backup / Export

- **Flows**: Export from Langflow UI → JSON files, or use the Langflow API: `GET /api/v1/flows/`
- **Database**: Neon Point-in-Time Recovery (30-day window) via `wrangler d1 time-travel restore` equivalent. Use Neon Console → Branches → Time Travel.
- **Manual DB backup**: `pg_dump <neon-url> > langflow-backup-$(date +%Y%m%d).sql`

## Known Issues

1. **Cold start ~90-120s**: The 1.08GB Langflow image takes ~90s to boot. First request after deploy or after 30m idle will be slow. The keep-warm cron on the main Plane worker pattern could be added here.
2. **CF Bot Fight Mode blocks API calls from non-browser clients**: `/api/v1/login` returns a Turnstile challenge for curl. Browser-based access works normally. Add a WAF skip rule for `/api/v1/*` if M2M API access is needed.
3. **R2 S3 storage untested**: Langflow may or may not support custom S3 endpoints. The env vars `AWS_ENDPOINT_URL_S3` + `AWS_DEFAULT_REGION=auto` are set but empirical testing needed.
4. **Single worker only**: No Redis provisioned, so `LANGFLOW_WORKERS=1`. Multi-worker mode needs Upstash Redis + `LANGFLOW_REDIS_QUEUE_URL`.
5. **No Langfuse/Sentry observability wired**: Can be added later. Container logs available via CF Observability.
6. **"Await admin activation" shown after sign-up despite `LANGFLOW_NEW_USER_IS_ACTIVE=true`**: This is a static UI string in Langflow's frontend. The actual behavior is correct — users can log in immediately without admin approval. Verified via Playwright 2026-07-01.

## Follow-ups

1. **Add WAF skip rule** for `/api/v1/*` on `langflow.projectsites.dev` to allow M2M API access
2. **Add keep-warm cron** (`*/5 * * * *`) to prevent 30m sleep cold starts
3. **Test R2 S3 storage** with Langflow
4. **Test multi-worker mode** with Upstash Redis
5. **Wire Langfuse tracing** if existing secrets present
6. **Seed golden starter flows** (site-intake-to-brief, local-SEO, lead-triage, RAG-FAQ, test-my-app)

## Acceptance Criteria

- [x] `https://langflow.projectsites.dev/` resolves
- [x] TLS is valid
- [x] `/` returns 200 OK
- [x] Page visibly shows Langflow login UI
- [x] `LANGFLOW_AUTO_LOGIN=False`
- [x] No default password committed
- [x] Langflow uses Neon Postgres
- [x] Cloudflare used as DNS/front-door layer
- [x] CF Workers Containers attempted first (and succeeded)
- [x] R2 storage documented with follow-up plan
- [x] Upstash Redis not needed (single-worker)
- [x] Smoke-test script exists (`scripts/smoke-langflow.sh`)
- [x] Playwright login-page test exists (`apps/project-sites/e2e/langflow-login.spec.ts`)
- [x] Deployment docs exist
