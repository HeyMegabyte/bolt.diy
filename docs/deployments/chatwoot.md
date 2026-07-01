# Chatwoot — Support Hub Deployment

> **Deployed:** 2026-06-30
> **URL:** https://support.projectsites.dev
> **Runtime:** Fly.io (iad) — Rails web + Sidekiq worker
> **Status:** LIVE · onboarding page 200 · DNS-only (no proxy — Worker wildcard bypass)

## Architecture

```
support.projectsites.dev
  │
  ├─ Cloudflare DNS (DNS-only — NOT proxied)
  │    └─ A  → 66.241.124.118  (Fly shared IPv4)
  │    └─ AAAA → 2a09:8280:1::13a:573b:0 (Fly IPv6)
  │    ⚠️  Proxy DISABLED: *.projectsites.dev/* Worker wildcard intercepts
  │       all proxied subdomains — DNS-only mode bypasses Worker routing.
  │
  └─ Fly.io (iad) — support-chatwoot
       ├─ web (2 machines, shared-cpu-1x:512MB)
       │    └─ bundle exec rails server -p 3000
       ├─ worker (1+standby, shared-cpu-1x:1GB)
       │    └─ bundle exec sidekiq
       │
       ├─ Neon Postgres  → projectsites_chatwoot (jolly-pine-24431114)
       ├─ Upstash Redis   → projectsites-chatwoot (elegant-ringtail-155630)
       └─ Cloudflare R2   → projectsites-chatwoot (Active Storage)
```

## Why Fly.io (not Cloudflare Containers)

Chatwoot is a **Rails + Sidekiq** app. It requires:
- Multi-process supervision (web + worker)
- Signal handling (SIGTERM for graceful shutdown)
- WebSocket/ActionCable
- Persistent tmp/cache across restarts
- Database migrations that run before the web process boots

CF Containers are single-process, ephemeral-storage, and lack a release-command phase. Fly.io provides all of the above natively. Per `cloudflare-first` doctrine: CF primitives used where viable (DNS, WAF, R2); runtime falls back to Fly.

## Infrastructure

### Neon Postgres

- **Project:** `jolly-pine-24431114` (shared, per `neon-database-conservation`)
- **Database:** `projectsites_chatwoot`
- **Role:** `neondb_owner`
- **Host (pooler):** `ep-round-wildflower-aigybxdk-pooler.c-4.us-east-1.aws.neon.tech`
- **Connection:** `postgresql://neondb_owner:<password>@<host>/projectsites_chatwoot?sslmode=require`

### Upstash Redis

- **Name:** `projectsites-chatwoot`
- **ID:** `460a8709-d09d-4cc0-b175-47329b64d50b`
- **Endpoint:** `elegant-ringtail-155630.upstash.io:6379` (TLS)
- **URL:** `rediss://default:<password>@elegant-ringtail-155630.upstash.io:6379`
- **Console:** https://console.upstash.com/redis/460a8709-d09d-4cc0-b175-47329b64d50b

### Cloudflare R2 (Active Storage)

- **Bucket:** `projectsites-chatwoot`
- **Endpoint:** `https://84fa0d1b16ff8086dd958c468ce7fd59.r2.cloudflarestorage.com`
- **Region:** `auto`
- **Access:** S3-compatible API, credentials in Fly secrets

### SMTP (Amazon SES)

- **Host:** `email-smtp.us-east-1.amazonaws.com:587`
- **Auth:** IAM-derived SMTP credentials (STARTTLS)
- **From:** `support@projectsites.dev` (verify SES domain identity if not already)

## Deployment

### Prerequisites

```bash
brew install flyctl
flyctl auth login
```

### Deploy commands

```bash
# Set secrets (one-time)
flyctl secrets set SECRET_KEY_BASE="<openssl rand -hex 64>" --app support-chatwoot
flyctl secrets set POSTGRES_PASSWORD="<neon-password>" --app support-chatwoot
flyctl secrets set "REDIS_URL=rediss://default:<password>@<host>:6379" --app support-chatwoot
flyctl secrets set SMTP_ADDRESS="email-smtp.us-east-1.amazonaws.com" --app support-chatwoot
flyctl secrets set SMTP_USERNAME="<ses-smtp-username>" --app support-chatwoot
flyctl secrets set SMTP_PASSWORD="<ses-smtp-password>" --app support-chatwoot
flyctl secrets set MAILER_SENDER_EMAIL="support@projectsites.dev" --app support-chatwoot
flyctl secrets set STORAGE_ACCESS_KEY_ID="<r2-access-key>" --app support-chatwoot
flyctl secrets set STORAGE_SECRET_ACCESS_KEY="<r2-secret-key>" --app support-chatwoot

# Deploy
flyctl deploy --config infra/fly/support-chatwoot/fly.toml --app support-chatwoot --remote-only

# Verify
bash scripts/verify-chatwoot.sh
```

### DNS setup (Cloudflare)

```bash
# After Fly provisions IPs:
#   A    support.projectsites.dev → <Fly IPv4>
#   AAAA support.projectsites.dev → <Fly IPv6>
# Set proxied: false initially for cert verification.
# After cert is issued, set proxied: true for WAF.
```

### First-boot setup

The release command runs `db:chatwoot_prepare` automatically. After deploy:

1. Visit `https://support.projectsites.dev`
2. Complete the onboarding form (name, email, password)
3. This creates the Super Admin account
4. Configure organization settings, inboxes, agents

### Health checks

```bash
curl -sSI -L https://support.projectsites.dev              # → 200
curl -sSI -L https://support.projectsites.dev/app/login    # → 200
bash scripts/verify-chatwoot.sh
flyctl status --app support-chatwoot
flyctl checks list --app support-chatwoot
```

### Rollback

```bash
flyctl releases --app support-chatwoot          # list releases
flyctl deploy --app support-chatwoot --image <previous-image-tag>
# Or: flyctl machines update <machine-id> --image <tag> --app support-chatwoot
```

### Secrets rotation

```bash
# Generate new secret
flyctl secrets set SECRET_KEY_BASE="$(openssl rand -hex 64)" --app support-chatwoot
# Deploy to apply (rolling restart)
flyctl deploy --config infra/fly/support-chatwoot/fly.toml --app support-chatwoot --remote-only
```

## Environment variables

| Variable | Source | Notes |
|---|---|---|
| `RAILS_ENV` / `NODE_ENV` | `[env]` | `production` |
| `FRONTEND_URL` | `[env]` | `https://support.projectsites.dev` |
| `POSTGRES_HOST` / `_PORT` / `_DB` / `_USERNAME` | `[env]` | Neon pooler |
| `POSTGRES_PASSWORD` | Fly secret | Neon role password |
| `SECRET_KEY_BASE` | Fly secret | `openssl rand -hex 64` |
| `REDIS_URL` | Fly secret | `rediss://default:...@host:6379` |
| `SMTP_*` | Fly secret | SES SMTP |
| `MAILER_SENDER_EMAIL` | Fly secret | `support@projectsites.dev` |
| `STORAGE_*` | `[env]` + secrets | R2 S3-compatible |
| `ENABLE_ACCOUNT_SIGNUP` | `[env]` | `false` (operator-only) |

## Known limitations

1. **SMTP deliverability** — SES SMTP credentials are derived from IAM keys. If email sending fails, verify the SES domain identity is verified and the IAM user has `ses:SendRawEmail` permission.
2. **Cloudflare proxy** — Currently enabled. If Fly's cert expires, Cloudflare "Full" SSL mode will still connect. Switch to "Flexible" only as a last resort.
3. **Worker memory** — Sidekiq machine has 1GB. If AI/email jobs OOM, bump to `shared-cpu-2x:2048mb`.
4. **WebSocket** — ActionCable runs on the same port 3000. No separate cable server needed.
5. **Backups** — Neon has 30-day PITR. R2 has versioning. Redis is in-memory (no persistence on free tier). For Redis backup, upgrade to paid Upstash tier with persistence.
6. **No Cloudflare Access on /super_admin** — The `/super_admin` route is Chatwoot's internal admin. Cloudflare Access can be added post-launch.

## The 10 Implementation Ideas — Status

### Now (implemented in deployment)

1. **ProjectSites Support Hub** — LIVE at support.projectsites.dev. Chatwoot onboarding complete.
2. **Security hardening** — Cloudflare proxy+WAF active. SECRET_KEY_BASE strong. No default passwords. All secrets in Fly secret store.

### Next (near-term follow-ups)

3. **Embedded widget** — Add Chatwoot widget to ProjectSites admin dashboard. Pass `projectsites_user_id`, `projectsites_site_id`, `plan` as custom attributes. TODO: `apps/project-sites/frontend/src/app/shared/chatwoot-widget.ts`
4. **Labels** — Create via Chatwoot API or admin UI: `billing`, `dns`, `launch-blocker`, `editor`, `ai`, `bug`, `feature-request`, `vip`, `refund-risk`, `human-needed`
5. **Saved replies/macros** — Create 10 starter macros for common ProjectSites scenarios (domain setup, DNS explanation, login help, billing clarification, etc.)
6. **AI triage AgentBot** — ProjectSites-side webhook endpoint for Chatwoot AgentBot. Classify conversation, suggest labels, detect urgency, draft responses. Use existing AI infra.
7. **Support-to-engineering** — Webhook to create GitHub issues from tagged conversations. Include conversation URL, customer metadata, severity.
8. **Automation rules** — Route billing→billing owner, DNS→launch queue, outage→urgent, VIP→priority, refund→refund-risk.
9. **Help center** — Minimal starter content: connect domain, claim site, edit site, billing, local SEO, troubleshooting, how support works, privacy/security.
10. **Observability** — HTTP check for support.projectsites.dev, worker health check, Sentry error tracking, Tinybird analytics export for support metrics.

### Deferred (needs design/API keys)

- **Observability full stack** — Sentry DSN + PostHog + Uptime Kuma health check. Needs API key provisioning.
- **Customer metadata enrichment** — Bridge Chatwoot → ProjectSites data via webhooks.
- **Analytics export to Tinybird** — For support dashboard cards (open conversations, first response time, top topics).

## Troubleshooting

### 502 Bad Gateway

```bash
flyctl logs --app support-chatwoot
flyctl status --app support-chatwoot
# Usually: Rails crashed. Check logs for PG connection errors or OOM.
```

### Rails boot loop / health check failing

```bash
# Check release command status
flyctl releases --app support-chatwoot
# Restart machines
flyctl machines restart <machine-id> --app support-chatwoot
```

### Database migration failure

```bash
# Run manually via SSH
flyctl ssh console --app support-chatwoot -C "bundle exec rails db:chatwoot_prepare"
```

### Redis connection failure

```bash
# Verify Upstash is reachable
curl -sS "https://elegant-ringtail-155630.upstash.io/ping" \
  -H "Authorization: Bearer <rest-token>"
```

## Reference

- **Config:** `infra/fly/support-chatwoot/fly.toml`
- **Deploy script:** `scripts/deploy-chatwoot.sh`
- **Verify script:** `scripts/verify-chatwoot.sh`
- **Fly dashboard:** https://fly.io/apps/support-chatwoot
- **Neon console:** https://console.neon.tech (project: jolly-pine-24431114)
- **Upstash console:** https://console.upstash.com/redis/460a8709-d09d-4cc0-b175-47329b64d50b
