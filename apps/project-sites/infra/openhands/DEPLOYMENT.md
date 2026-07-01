# OpenHands Agent Canvas — Deployment Record

**Deployed:** 2026-06-30
**URL:** https://openhands.projectsites.dev
**Operator:** Brian Zalewski

## Stack decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Hosting provider | Fly.io | CF Containers cannot run Docker-in-Docker sandbox; Fly.io supports persistent volumes and long-lived WebSocket/SSE connections |
| OpenHands version | `ghcr.io/openhands/agent-canvas:1.1.0` | Latest stable (Jun 26, 2026) |
| Front door | Cloudflare Worker | Login page, session management, proxy, security headers |
| Session storage | Cloudflare KV | Low-latency edge session store with automatic TTL expiration |
| Sandbox mode | Local (no Docker) | Fly.io Firecracker VMs don't support nested Docker; for internal use behind Worker auth |
| Origin gateway | Nginx | Validates X-ProjectSites-Origin-Secret, proxies to :8000, supports WebSocket upgrade |
| Volumes | Fly.io persistent volume (10GB) | Stores OpenHands state, conversations, project workspaces |

## Why not Cloudflare Containers

Cloudflare Workers Containers are Firecracker-based and do not support:
- Docker-in-Docker (required for sandboxed agent execution)
- Persistent volumes with guaranteed durability across restarts
- Long-lived WebSocket/SSE connections >30min reliably
- The specific filesystem guarantees OpenHands expects

The Worker front door still provides the Cloudflare edge layer (login, security headers, proxy).

## Secrets created

| Secret | Scope | Storage |
|--------|-------|---------|
| OPENHANDS_ADMIN_PASSWORD | Worker | wrangler secret put |
| OPENHANDS_SESSION_SECRET | Worker | wrangler secret put |
| OPENHANDS_ORIGIN_SECRET | Worker + Fly.io | wrangler secret put + flyctl secrets |
| LOCAL_BACKEND_API_KEY | Fly.io origin | Auto-generated on first boot |
| OH_SECRET_KEY | Fly.io origin | Auto-generated on first boot |

## Fly.io Resources

- **App:** projectsites-openhands
- **Region:** iad (US East)
- **VM:** shared-cpu-4x (4 vCPU, 8 GB RAM)
- **Volume:** openhands_data (10 GB, mounted at /data)
- **Internal port:** 8080 (nginx gateway)
- **Backend port:** 8000 (Agent Canvas)

## Known limitations

1. **No Docker sandbox** — agent code executes directly on the Fly.io VM filesystem. Acceptable for internal, single-operator use behind Worker auth. For multi-user or internet-facing use, add a remote Docker sandbox host.
2. **No R2 backups yet** — backup script scaffolded but not implemented. Fly.io volume snapshots provide basic recovery.
3. **Single region** — iad only. Add regions if latency becomes an issue.
4. **No CI/CD pipeline** — manual deploy via deploy.sh.

## Next improvements (ranked)

1. Wire R2 backup script (`backup-to-r2.sh`)
2. Add remote Docker sandbox host for isolated agent execution
3. Add Cloudflare Access as optional second gate
4. Add Sentry error tracking for origin
5. Add Langfuse AI tracing
6. Implement the Automation Packs prompt templates
