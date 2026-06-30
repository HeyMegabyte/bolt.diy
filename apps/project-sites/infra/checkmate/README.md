# Checkmate — ProjectSites.dev Monitoring Control Plane

**Open-source uptime + infrastructure monitoring by BlueWave Labs, deployed for ProjectSites.dev.**

| | |
|---|---|
| **URL** | https://monitor.projectsites.dev |
| **Platform** | Fly.io (`projectsites-checkmate`, region: iad) |
| **Version** | v3.8.1 (pinned) |
| **Upstream** | [github.com/bluewave-labs/Checkmate](https://github.com/bluewave-labs/Checkmate) |
| **License** | Open source (AGPL — isolated behind HTTP boundary per `agpl-isolation-via-http-boundary`) |

## Architecture

```
                        ┌─────────────────────┐
                        │   Cloudflare DNS     │
                        │  monitor.projectsites│
                        │   .dev (proxied)     │
                        └─────────┬───────────┘
                                  │ HTTPS
                        ┌─────────┴───────────┐
                        │   Fly.io Machine     │
                        │   projectsites-      │
                        │   checkmate          │
                        │                      │
                        │  ┌────────────────┐  │
                        │  │ nginx :80       │  │ ← SPA + API proxy
                        │  │ / → React SPA   │  │
                        │  │ /api/* → :52345 │  │
                        │  └───────┬────────┘  │
                        │          │           │
                        │  ┌───────┴────────┐  │
                        │  │ Node.js :52345 │  │ ← Express + Mongoose
                        │  │ QUEUE_MODE=    │  │   In-process queue
                        │  │ primary        │  │   (no external Redis)
                        │  └───────┬────────┘  │
                        │          │           │
                        │  ┌───────┴────────┐  │
                        │  │ MongoDB 7.0    │  │ ← Persistent volume
                        │  │ 127.0.0.1:27017│  │   /data/db (1 GB)
                        │  └────────────────┘  │
                        └──────────────────────┘
```

**Why Fly.io, not Cloudflare-only:**
- Checkmate uses MongoDB — CF Containers have ephemeral disks.
- D1/SQLite cannot replace MongoDB without an invasive rewrite.
- Fly.io provides persistent volumes for durable MongoDB storage.
- Cloudflare remains the DNS, proxy, and WAF front door.

## Quick Start

```bash
cd apps/project-sites/infra/checkmate

# Deploy
bash scripts/deploy.sh

# Smoke test
CHECKMATE_URL=https://monitor.projectsites.dev bash scripts/smoke.sh

# View logs
flyctl logs --app projectsites-checkmate
```

## Deploy

```bash
bash apps/project-sites/infra/checkmate/scripts/deploy.sh
```

The deploy script:
1. Generates a strong `JWT_SECRET` if not already set
2. Creates the Fly.io app if it doesn't exist
3. Creates the persistent MongoDB volume (one-time, 1 GB)
4. Builds and deploys the Docker image
5. Allocates a shared IPv4
6. Creates/updates the Cloudflare DNS record (proxied)
7. Waits for DNS + TLS propagation

## Smoke Test

```bash
CHECKMATE_URL=https://monitor.projectsites.dev bash apps/project-sites/infra/checkmate/scripts/smoke.sh
```

Verifies: HTTP 200, TLS valid, Checkmate UI indicators, health endpoint, API reachability, security headers.

## Playwright E2E

```bash
cd apps/project-sites
CHECKMATE_URL=https://monitor.projectsites.dev npx playwright test infra/checkmate/tests/checkmate-login.spec.ts
```

## Adding Monitors

After creating an admin account at https://monitor.projectsites.dev:

### ProjectSites Critical Endpoint Pack

Add these monitors in Checkmate (type: HTTP, interval: 60s):

1. https://projectsites.dev
2. https://www.projectsites.dev
3. https://claimyour.site
4. https://monitor.projectsites.dev (self-monitoring)
5. Other live ProjectSites endpoints (verify before adding)

### Adding via Checkmate API

```bash
# Get an API token from Settings → API Keys
TOKEN="<your-api-token>"

# Create a monitor
curl -X POST https://monitor.projectsites.dev/api/v1/monitors \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ProjectSites Homepage",
    "type": "http",
    "url": "https://projectsites.dev",
    "interval": 60,
    "timeout": 30
  }'
```

## Backup & Restore

```bash
# Backup (daily via cron recommended)
bash apps/project-sites/infra/checkmate/scripts/backup-mongo.sh --r2

# Restore
bash apps/project-sites/infra/checkmate/scripts/restore-mongo.sh /path/to/backup.gz
```

RPO: 24 hours | RTO: <15 minutes

## Rollback

```bash
flyctl releases rollback --app projectsites-checkmate
```

## Environment Variables

See `.env.example` for the full list. Secrets are managed via Fly.io:

```bash
flyctl secrets set JWT_SECRET="$(openssl rand -hex 64)" --app projectsites-checkmate
```

## 10 Best Implementation Ideas — Status

| # | Idea | Status |
|---|------|--------|
| 1 | ProjectSites Critical Endpoint Pack | 📋 After admin setup |
| 2 | Login-Page Truth Test | ✅ smoke.sh + Playwright spec |
| 3 | API Contract Checks | 📋 After API docs explored |
| 4 | Public Status Page | 📋 After monitors seeded |
| 5 | Deployment-Aware Maintenance Windows | 📋 After API integration |
| 6 | Alert Routing (email/Slack/webhook) | 📋 After SMTP provisioned |
| 7 | Capture Agent Kit | 📋 See docs/runbook.md |
| 8 | Domain/DNS/Cert Monitoring | 📋 After monitors seeded |
| 9 | PageSpeed Regression Monitoring | 📋 After monitors seeded |
| 10 | Backup/Restore/Disaster Drill | ✅ scripts/backup-mongo.sh + restore-mongo.sh |

## Files

```
infra/checkmate/
├── README.md
├── Dockerfile              # Multi-process: MongoDB + backend + nginx
├── fly.toml                # Fly.io app config
├── supervisord.conf        # Process supervisor config
├── .env.example            # Environment variable reference
├── nginx/
│   └── default.conf        # SPA + API reverse proxy config
├── scripts/
│   ├── deploy.sh           # Full deploy pipeline
│   ├── smoke.sh            # HTTP + TLS + UI smoke test
│   ├── entrypoint.sh       # Container entrypoint
│   ├── init-mongo.js       # MongoDB init script
│   ├── backup-mongo.sh     # mongodump + optional R2 upload
│   └── restore-mongo.sh    # mongorestore + restart
├── tests/
│   └── checkmate-login.spec.ts  # Playwright login page test
└── docs/
    └── runbook.md           # Operational runbook
```
