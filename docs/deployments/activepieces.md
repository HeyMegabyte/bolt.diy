# Activepieces Deployment Proof — automation.projectsites.dev

**Deployed:** 2026-06-30  
**Status:** ✅ LIVE — HTTP 200, TLS valid, login page renders  
**URL:** https://automation.projectsites.dev

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| `https://automation.projectsites.dev` resolves | ✅ |
| TLS is valid | ✅ Let's Encrypt via Fly.io |
| Login page renders | ✅ "Activepieces" title, sign-in form |
| `curl -I` returns HTTP 200 | ✅ |
| Neon Postgres (not PGLite) | ✅ `projectsites_activepieces` on `jolly-pine-24431114` |
| Upstash Redis (not memory Redis) | ✅ `projectsites-activepieces`, TLS, us-east-1 |
| Secrets not committed | ✅ Fly secrets + wrangler secrets |
| App/worker split documented | ✅ Currently WORKER_AND_APP; split path documented |
| Cloudflare-first attempt documented | ✅ CF Containers attempted; timed out — documented below |
| Smoke test exists and passes | ✅ `smoke.sh` — HTTP 200, TLS, login markers, HSTS |
| Deployment recreatable from docs/scripts | ✅ README + fly.toml + smoke.sh |

## Hosting Decision

**Chosen target:** Fly.io  
**Why not Cloudflare Workers Containers:** The `activepieces/activepieces:latest` Docker image is ~500MB with complex startup (Postgres migrations + Redis connect + piece sync). CF Container DO cold-start exceeded practical timeouts. After 5+ minutes of timeout on every request, pivoted to Fly.io per the hosting priority order.

**CF front-door:** DNS CNAME directly to Fly (no CF proxy). If CF proxy/WAF is desired later, redeploy the thin-proxy Worker from `infra/activepieces/worker.ts` and flip DNS to `proxied: true`.

## Infrastructure

| Component | Provider | Resource |
|-----------|----------|----------|
| Compute | Fly.io | `projectsites-activepieces` (iad, shared-cpu-2x, 4GB) |
| Database | Neon | `projectsites_activepieces` on Listmonk project (`jolly-pine-24431114`) |
| Redis | Upstash | `projectsites-activepieces` (`3eb65767`) |
| DNS | Cloudflare | CNAME `automation` → `56k39wn.projectsites-activepieces.fly.dev` |
| TLS | Let's Encrypt (via Fly) | Auto-renewing |

## Healthcheck

```bash
curl -sS -o /dev/null -w '%{http_code}' https://automation.projectsites.dev/
# 200
```

## Smoke Test Output (2026-06-30)

```
=== Activepieces Smoke Test ===
URL: https://automation.projectsites.dev

1. HTTP status...
   PASS: HTTP 200
2. Login page markers...
   PASS: Login page found
3. TLS certificate...
   PASS: TLS valid
4. API health...
   API status: HTTP 200
5. Security headers...
   PASS: HSTS present
   PASS: X-Content-Type-Options present

=== Smoke test PASSED ===
```

## Rollback

```bash
flyctl deploy -a projectsites-activepieces --image activepieces/activepieces:<previous-tag>
```

## Upgrade

```bash
cd apps/project-sites/infra/activepieces
flyctl deploy -a projectsites-activepieces
```

## Backup/Restore

- **Neon:** Point-in-time recovery + branching via Neon Console/API
- **Upstash:** Daily backups via Upstash Console
- **Fly:** Stateless — no volumes to back up

## Secret Names

**Fly secrets:** `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET`, `AP_POSTGRES_HOST`, `AP_POSTGRES_PORT`, `AP_POSTGRES_DATABASE`, `AP_POSTGRES_USERNAME`, `AP_POSTGRES_PASSWORD`, `AP_REDIS_HOST`, `AP_REDIS_PORT`, `AP_REDIS_PASSWORD`

**CF Worker secrets (cleaned up):** Removed after DNS switched to direct Fly CNAME.

## Files

```
apps/project-sites/infra/activepieces/
├── Dockerfile              # Minimal base image (for CF Container attempt)
├── fly.toml                # Fly.io app configuration
├── wrangler.toml           # CF Worker proxy (not deployed; DNS direct)
├── worker.ts               # CF Worker proxy (not deployed; DNS direct)
├── smoke.sh                # Smoke test script
└── README.md               # Full deployment documentation
```
