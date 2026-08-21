# Onyx Deployment — onyx.projectsites.dev

**Platform:** Fly.io (Path B — Cloudflare Containers infeasible for multi-process app)
**Backing services:** Neon Postgres + Upstash Redis + Cloudflare R2
**LLM:** llm.projectsites.dev (LiteLLM gateway)
**DNS:** Cloudflare A/AAAA → Fly.io

## Why not Cloudflare Containers (Path A)

Onyx (even Lite) requires 4+ long-running processes: Python FastAPI API server, Next.js web server, Celery background workers, and nginx reverse proxy. CF Workers Containers (DO-based) run ONE container image per Durable Object — no multi-container orchestration. Combining all processes into a single image is fragile and unsupported upstream. Onyx Standard additionally needs OpenSearch/Vespa (4GB+ RAM, persistent disk) and model servers which can't run on CF Containers.

## Architecture

Single Fly.io machine (shared-cpu-4x, 8GB) running all Onyx services via supervisor:

| Process | Port | Description |
|---------|------|-------------|
| nginx | 8080 | Reverse proxy — `/api/*`/`/auth/*` → API, `/*` → web |
| onyx_api_server | 8081 (internal) | FastAPI backend, alembic migrations on startup |
| onyx_web_server | 3000 | Next.js 16 frontend |
| celery workers | — | Background tasks (9 worker queues + beat) |

## Environment Variables

### Public (in fly.toml)
- `AUTH_TYPE=basic`
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_SSL=true`
- `DISABLE_VECTOR_DB=true` (Lite mode — no OpenSearch/Vespa)
- `FILE_STORE_BACKEND=postgres` (use Postgres for file storage)
- `INTERNAL_URL=http://127.0.0.1:8081`
- `LOG_LEVEL=info`

### Secrets (flyctl secrets)
- `POSTGRES_PASSWORD` — Neon database password
- `REDIS_PASSWORD` — Upstash Redis password
- `USER_AUTH_SECRET` — openssl rand -hex 32

### Optional
- `GEN_AI_API_KEY` — LLM API key for chat/RAG
- `GEN_AI_API_ENDPOINT` — LLM gateway URL (e.g., `https://llm.projectsites.dev`)

## Infrastructure

| Service | Resource | Details |
|---------|----------|---------|
| Neon | `projectsites_onyx` | On shared `jolly-pine-24431114` project, pooled connection |
| Upstash | `projectsites-onyx` | `assuring-cat-155637.upstash.io:6379`, TLS enabled |
| Fly.io | `onyx-projectsites` | shared-cpu-4x, 8GB, gru region |
| Cloudflare DNS | A + AAAA | `onyx.projectsites.dev` → Fly.io IPs |

## Deploy

```bash
cd apps/project-sites/infra/onyx

# Set secrets (one-time)
flyctl secrets set -a onyx-projectsites \
  POSTGRES_PASSWORD=... \
  REDIS_PASSWORD=... \
  USER_AUTH_SECRET=$(openssl rand -hex 32)

# Deploy
flyctl deploy -a onyx-projectsites

# Verify
curl -L -s -o /dev/null -w "%{http_code}\n" https://onyx.projectsites.dev/
bash ../../scripts/check-onyx-deploy.sh
```

## Rollback

```bash
flyctl releases -a onyx-projectsites          # list releases
flyctl deploy -a onyx-projectsites --image <previous-image>
```

## Logs

```bash
flyctl logs -a onyx-projectsites              # app logs
flyctl ssh console -a onyx-projectsites       # SSH into machine
# Inside: supervisorctl status, tail /var/log/onyx/*.log
```

## Known limitations

- **Cold start:** First deploy runs 50+ alembic migrations (~5-10 min). Redeploys are fast.
- **No vector search:** `DISABLE_VECTOR_DB=true` means no RAG/connectors/search. Enable by adding OpenSearch/Vespa.
- **No model server:** Embeddings/reranking unavailable without model server.
- **File storage in Postgres:** `FILE_STORE_BACKEND=postgres` works for small files. Switch to S3/R2 for production.
- **Single machine:** No HA. Add more machines in fly.toml for production.

## Upgrading from Lite to Standard

1. Provision OpenSearch or Vespa (recommended: Fly.io VM or managed service)
2. Provision model server (embeddings + reranking)
3. Set `DISABLE_VECTOR_DB=false`
4. Configure `OPENSEARCH_HOST`, `MODEL_SERVER_HOST`
5. Switch `FILE_STORE_BACKEND=s3` with R2/MinIO credentials
6. Redeploy

## MCP

Onyx supports MCP server. Enable with env vars once API is stable:

```bash
flyctl secrets set -a onyx-projectsites \
  MCP_SERVER_ENABLED=true \
  MCP_SERVER_PORT=8090
```

See `.mcp.example.json` for Claude Code integration.
