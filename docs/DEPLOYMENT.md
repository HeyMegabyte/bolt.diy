# Project Sites — Deployment & CI/CD Guide

> Auth chain, pre-flight bindings, deploy commands, smoke-test curls, rollback.
> Pairs with [ARCHITECTURE.md](./ARCHITECTURE.md) (system diagram) and
> [AI_INTEGRATION.md](./AI_INTEGRATION.md) (AI Gateway + RAG + Media).

## Quick Reference

| Step | Command |
| ---- | ------- |
| 1. Auth | `eval "$(./bindings.sh)"` or set `CLOUDFLARE_API_TOKEN` |
| 2. Typecheck | `cd apps/project-sites && npm run typecheck` |
| 3. Tests | `npm test && npx playwright test` |
| 4. Deploy worker | `npx wrangler deploy --env production` |
| 5. Deploy frontend | `cd frontend && npm run deploy:production` |
| 6. Smoke | curl `/health`, `/api/media/assets`, `/api/env-vars`, `/api/inbox/tasks` |
| 7. Rollback | `npx wrangler rollback <version-id> --env production` |

## Auth Fallback Chain

Wrangler accepts credentials in three forms. Try in priority order:

1. **`CLOUDFLARE_API_TOKEN`** (preferred — scoped token)
   ```bash
   export CLOUDFLARE_API_TOKEN=$(/Users/Apple/.local/bin/get-secret CLOUDFLARE_API_TOKEN)
   export CLOUDFLARE_ACCOUNT_ID=84fa0d1b16ff8086dd958c468ce7fd59
   ```
   Token needs: `Workers Scripts:Edit`, `Workers KV:Edit`, `D1:Edit`,
   `Workers R2 Storage:Edit`, `Workers AI:Edit`, `AI Gateway:Edit`,
   `Pages:Edit`, `Workers Containers:Edit`, `Cache Purge`.

2. **`CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`** (global key — works everywhere
   the token lacks a permission group)
   ```bash
   export CLOUDFLARE_API_KEY=$(/Users/Apple/.local/bin/get-secret CLOUDFLARE_API_KEY)
   export CLOUDFLARE_EMAIL=blzalewski@gmail.com
   ```

3. **Interactive** (if both above are stale or missing)
   ```bash
   npx wrangler login
   ```

Verify auth before deploying:

```bash
npx wrangler whoami
```

## Pre-flight Bindings (one-time per environment)

Run these once before the first deploy of a new environment. They are
idempotent — re-running on an existing resource is a no-op.

### Vectorize index (RAG_INDEX)

```bash
# Create the 768-dim cosine index
npx wrangler vectorize create projectsites-rag \
  --dimensions=768 --metric=cosine

# Metadata indexes required by services/rag.ts queries
npx wrangler vectorize create-metadata-index projectsites-rag \
  --property-name=kind --type=string

npx wrangler vectorize create-metadata-index projectsites-rag \
  --property-name=orgId --type=string
```

Verify:

```bash
npx wrangler vectorize get projectsites-rag
npx wrangler vectorize list-metadata-index projectsites-rag
```

### AI Gateway

Pre-create the gateway named `projectsites` at
[dash.cloudflare.com → AI Gateway](https://dash.cloudflare.com/?to=/:account/ai/ai-gateway).
Enable Logs + Cache. Then flip `AI_GATEWAY_ENABLED = "true"` in
`wrangler.toml` (already set for production).

### D1 + KV + R2

Already provisioned in production — IDs in the Cloudflare Resource IDs table
below. For a new environment:

```bash
npx wrangler d1 create project-sites-db-<env>
npx wrangler kv namespace create CACHE_<ENV>
npx wrangler kv namespace create PROMPT_STORE_<ENV>
npx wrangler r2 bucket create project-sites-<env>
```

Paste the resulting IDs into `wrangler.toml` under the matching
`[env.<env>]` block.

### Secrets

Push every secret listed in `.env.example` via `wrangler secret put`. Use
`/Users/Apple/.local/bin/get-secret <KEY>` to fetch from the local store:

```bash
for KEY in ANTHROPIC_API_KEY OPENAI_API_KEY RESEND_API_KEY \
           STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET \
           SENTRY_DSN POSTHOG_API_KEY \
           MCP_ENCRYPTION_KEY GOOGLE_API_KEY; do
  VAL=$(/Users/Apple/.local/bin/get-secret "$KEY" 2>/dev/null) \
    && echo "$VAL" | npx wrangler secret put "$KEY" --env production
done
```

`MCP_ENCRYPTION_KEY` is data-at-rest (Tier 1.5) — NEVER rotate without a
re-encryption job. Every other secret can be rotated freely.

## Smoke Tests (post-deploy)

Run against the production URL after every deploy. Failure on any of these =
rollback.

```bash
BASE=https://projectsites.dev
TOKEN=<bearer-from-/api/auth/me>

# 1. Health
curl -fsS "$BASE/health" | jq '.status'        # expect "ok"

# 2. Media library list (returns [] for a fresh org)
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/media/assets" | jq '.assets | length'

# 3. Env vars list
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/env-vars" | jq '.env_vars | length'

# 4. Task tray
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/inbox/tasks" | jq '.tasks | length'

# 5. AI Gateway round-trip (assertion: latency < 2000ms)
time curl -fsS -H "Authorization: Bearer $TOKEN" \
  -X POST "$BASE/api/ai/categorize" \
  -H 'content-type: application/json' \
  -d '{"text":"pizza place in Brooklyn"}' | jq '.category'

# 6. Site serving — verify R2 + KV cache path
curl -fsSI "$BASE/" | grep -i 'content-type'   # expect text/html
```

If any check 5xx's, drop straight to the Rollback section.

## Rollback

Cloudflare keeps the last 10 worker versions. Roll back instantly:

```bash
# List recent versions
npx wrangler deployments list --env production

# Roll back to a specific version-id
npx wrangler rollback <version-id> --env production

# Verify
curl -fsS https://projectsites.dev/health | jq '.version'
```

For D1 incidents, use Time Travel (30-day PIT recovery):

```bash
npx wrangler d1 time-travel restore project-sites-db-production \
  --timestamp=2026-05-25T12:00:00Z
```

For R2 incidents, the marketing path is the only mutable surface in normal
ops — just re-upload from `public/`:

```bash
cd apps/project-sites
./scripts/upload-marketing.sh production   # idempotent overwrite
```

---

## Environments

| Environment | Worker Name | Domain | D1 Database |
|------------|-------------|--------|-------------|
| Development | (local) | `localhost:8787` | `project-sites-db` (dev) |
| Staging | `project-sites-staging` | `sites-staging.megabyte.space` | `project-sites-db-staging` |
| Production | `project-sites` | `sites.megabyte.space` | `project-sites-db-production` |

### Pages (bolt.diy frontend)

| Environment | Domain | Branch |
|------------|--------|--------|
| Production | `bolt.megabyte.space` | `main` |
| Staging | `bolt-staging.megabyte.space` | `staging` |

## Cloudflare Resource IDs

| Resource | ID |
|----------|-----|
| Account | `84fa0d1b16ff8086dd958c468ce7fd59` |
| Zone (megabyte.space) | `75a6f8d5e441cd7124552976ba894f83` |
| Pages project | `76c34b4f-1bd1-410c-af32-74fd8ee3b23f` |
| D1 dev | `f5b59818-c785-4807-8aca-282c9037c58c` |
| D1 staging | `7bdf6256-7b5d-417f-9b29-c7466ec78508` |
| D1 production | `ea3e839a-c641-4861-ae30-dfc63bff8032` |
| KV CACHE (dev) | `dc6e00fd0de94cc3afc2c6c774347312` |
| KV PROMPT_STORE (dev) | `c74012c6439e403487ece3f66b6f1362` |

## Authentication

Wrangler uses Global API Key + email (not an API token):

```bash
export CLOUDFLARE_API_KEY=<your-global-api-key>
export CLOUDFLARE_EMAIL=blzalewski@gmail.com
```

## Deploy Commands

### Worker Deployment

```bash
cd apps/project-sites

# Staging
CLOUDFLARE_API_KEY=xxx CLOUDFLARE_EMAIL=xxx npx wrangler deploy --env staging

# Production
CLOUDFLARE_API_KEY=xxx CLOUDFLARE_EMAIL=xxx npx wrangler deploy --env production
```

### Marketing Homepage Upload (R2)

The marketing homepage is a static file served from R2, not bundled with the worker:

```bash
cd apps/project-sites

# Staging
npx wrangler r2 object put project-sites-staging/marketing/index.html \
  --file public/index.html --content-type text/html --remote

# Production
npx wrangler r2 object put project-sites-production/marketing/index.html \
  --file public/index.html --content-type text/html --remote

# Upload all static assets
for file in public/*.ico public/*.png public/*.svg public/*.xml public/*.webmanifest; do
  name=$(basename "$file")
  ext="${name##*.}"
  case "$ext" in
    ico) ct="image/x-icon" ;;
    png) ct="image/png" ;;
    svg) ct="image/svg+xml" ;;
    xml) ct="application/xml" ;;
    webmanifest) ct="application/manifest+json" ;;
    *) ct="application/octet-stream" ;;
  esac
  npx wrangler r2 object put "project-sites-production/marketing/$name" \
    --file "$file" --content-type "$ct" --remote
done

# Upload legal pages
npx wrangler r2 object put project-sites-production/marketing/privacy.html \
  --file public/privacy.html --content-type text/html --remote
npx wrangler r2 object put project-sites-production/marketing/terms.html \
  --file public/terms.html --content-type text/html --remote
```

### D1 Migrations

D1 doesn't have a built-in migration runner. Apply SQL manually:

```bash
# Against remote staging
npx wrangler d1 execute project-sites-db-staging --remote --file supabase/migrations/00001_initial_schema.sql

# Against remote production
npx wrangler d1 execute project-sites-db-production --remote --file supabase/migrations/00001_initial_schema.sql

# NOTE: The migration SQL uses Postgres syntax (gen_random_uuid, TIMESTAMPTZ, etc.)
# You may need to adapt for D1 SQLite syntax:
# - UUID → TEXT, TIMESTAMPTZ → TEXT, BOOLEAN → INTEGER, JSONB → TEXT
# - Remove triggers, RLS policies, and Postgres-specific functions
```

### Secrets Management

Set secrets via wrangler (stored encrypted, not in wrangler.toml):

```bash
cd apps/project-sites

# Required secrets
npx wrangler secret put STRIPE_SECRET_KEY --env staging
npx wrangler secret put STRIPE_PUBLISHABLE_KEY --env staging
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env staging
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
npx wrangler secret put GOOGLE_PLACES_API_KEY --env staging
npx wrangler secret put POSTHOG_API_KEY --env staging
npx wrangler secret put CF_API_TOKEN --env staging
npx wrangler secret put CF_ZONE_ID --env staging

# Optional secrets
npx wrangler secret put SENDGRID_API_KEY --env staging
npx wrangler secret put SENTRY_DSN --env staging
npx wrangler secret put OPENAI_API_KEY --env staging
npx wrangler secret put TWILIO_ACCOUNT_SID --env staging
npx wrangler secret put TWILIO_AUTH_TOKEN --env staging
npx wrangler secret put TWILIO_PHONE_NUMBER --env staging
```

## Workers Routes

Configured in Cloudflare dashboard (not wrangler.toml):

```
*-sites.megabyte.space/*           → project-sites (production)
*-sites-staging.megabyte.space/*   → project-sites-staging (staging)
```

These route patterns capture subdomain traffic like `vitos-salon-sites.megabyte.space`.

## Cloudflare Access

Bypass apps are configured for these domains to allow public access:
- `sites.megabyte.space`
- `sites-staging.megabyte.space`
- `bolt.megabyte.space`
- `bolt-staging.megabyte.space`

Without these bypass rules, Cloudflare Access would gate all traffic.

## CI/CD Pipeline

### GitHub Actions (`.github/workflows/project-sites.yaml`)

```yaml
Triggers:
  - Push to main (deploy to production)
  - Push to staging branch (deploy to staging)
  - PR to main (lint + test only)

Jobs:
  1. lint
     - cd apps/project-sites && npm run lint
     - cd packages/shared && npm run lint

  2. typecheck
     - cd packages/shared && npx tsc --noEmit
     - cd apps/project-sites && npx tsc --noEmit

  3. unit-tests
     - cd packages/shared && npm test
     - cd apps/project-sites && npm test

  4. e2e-tests (on PR only)
     - Install Playwright browsers
     - Start local server
     - cd apps/project-sites && npx playwright test

  5. deploy (on push to main/staging)
     - Deploy worker: npx wrangler deploy --env {env}
     - Upload homepage: wrangler r2 object put ...
```

## Local Development

### Prerequisites
- Node.js >= 18.18.0
- npm (not pnpm — electron-builder breaks it)
- Wrangler CLI (`npm install -g wrangler` or use npx)

### Setup
```bash
# Install shared package deps
cd packages/shared && npm install --legacy-peer-deps

# Install worker deps
cd apps/project-sites && npm install --legacy-peer-deps

# Run all checks
cd packages/shared && npm run check
cd apps/project-sites && npm run check

# Start local dev server
cd apps/project-sites && npx wrangler dev
```

### Local Dev Server
- Runs on `http://localhost:8787`
- Auto-provisions local D1 database
- KV and R2 are local (not remote)
- No Queue binding (Queue not enabled on account)

## Rollback Procedure

### Worker Rollback
```bash
# List recent deployments
npx wrangler deployments list --env production

# Rollback to previous deployment
npx wrangler rollback --env production
```

### Site Version Rollback

Sites are versioned. To rollback a specific site:
```sql
-- In D1, update the current_build_version to a previous version
UPDATE sites SET current_build_version = '2025-01-15T10-30-00-000Z'
WHERE id = '<site-id>';
```

The previous version's files remain in R2 (never deleted), so changing
the version pointer immediately serves the old version.

## Monitoring & Observability

### Cloudflare Dashboard
- Workers → project-sites → Logs (real-time tail)
- Workers → project-sites → Analytics (request metrics)
- Workers → project-sites → Workflows (AI pipeline status)
- D1 → project-sites-db-* → Query (ad-hoc SQL)
- R2 → project-sites-* → Objects (file browser)
- KV → (namespace) → Keys (cache inspection)

### External Services
- **Sentry**: Exception tracking with request_id correlation
- **PostHog**: Funnel analytics, user identification, event tracking

### Structured Log Format
```json
{
  "level": "info|warn|error",
  "service": "auth|billing|queue|search|ai_workflow|cron",
  "message": "Human-readable description",
  "request_id": "uuid",
  "...context": "additional fields"
}
```

All logs use `console.warn` (not `console.log` — blocked by ESLint).

## Troubleshooting

### Common Issues

1. **"Cannot find module @project-sites/shared"**
   - Run `npm install --legacy-peer-deps` in `apps/project-sites/`

2. **Wrangler auth errors**
   - Ensure `CLOUDFLARE_API_KEY` and `CLOUDFLARE_EMAIL` are set
   - Do NOT use `CLOUDFLARE_API_TOKEN` (not configured)

3. **D1 migration errors**
   - Postgres SQL needs manual adaptation for SQLite
   - Remove: triggers, RLS policies, gen_random_uuid()
   - Change: UUID→TEXT, TIMESTAMPTZ→TEXT, BOOLEAN→INTEGER

4. **Queue binding errors**
   - Queues are NOT yet enabled on the account
   - `QUEUE` binding is optional in Env type
   - Queue sections are commented out in wrangler.toml

5. **Homepage shows JSON instead of HTML**
   - Marketing homepage must be uploaded to R2 separately
   - Use the R2 upload commands above

6. **CSP blocking scripts on homepage**
   - CSP must include `'unsafe-inline'` in script-src
   - Check `src/middleware/security_headers.ts`

## Error Tracking & Observability

Sentry has been fully removed. Error tracking and observability now run on:

- **PostHog Cloud** — product analytics, behavior, funnels, feature flags,
  session replay where appropriate.
- **Axiom** (`logs.projectsites.dev`) — structured operational logs, service
  logs, error logs.
- **OpenTelemetry** — trace/log/metric correlation + transport via the
  `telemetry-router` Fly app (`infra/fly/telemetry-router`).
- **ClickHouse on Fly.io** — high-volume warehouse + customer analytics.

- **Sentry** (`@sentry/cloudflare`) — exception tracking + release tracking via
  `SENTRY_RELEASE`; source maps uploaded by `scripts/upload-sentry-sourcemaps.mjs`.

See [`observability/axiom.md`](./OBSERVABILITY.md) and
[`observability/otel.md`](./OBSERVABILITY.md).


---

<!-- folded from deployment/fly.md (2026-06-27) -->

# Fly.io Deployment Guide

This guide covers deploying and operating ClickHouse and Chatwoot on Fly.io. For the rationale behind using Fly.io for these services, see [fly-cloudflare-split.md](./ARCHITECTURE.md).

---

## Prerequisites

```bash
# Install fly CLI
curl -L https://fly.io/install.sh | sh

# Authenticate
fly auth login

# Verify
fly version
fly auth whoami
```

### Required Secrets

```bash
# Set in your local environment or CI
export FLY_API_TOKEN="..."
```

---

## ClickHouse

### Initial Deploy

```bash
# 1. Create the app
fly apps create projectsites-clickhouse --org personal

# 2. Create persistent volume (50GB NVMe)
fly volumes create clickhouse_data \
  --region iad \
  --size 50 \
  --app projectsites-clickhouse

# 3. Set secrets
fly secrets set \
  CLICKHOUSE_PASSWORD="<generate-strong-password>" \
  --app projectsites-clickhouse

# 4. Deploy
fly deploy --app projectsites-clickhouse \
  --config apps/clickhouse/fly.toml
```

### Update/Redeploy

```bash
fly deploy --app projectsites-clickhouse --config apps/clickhouse/fly.toml
```

### Environment Secrets Setup

```bash
# ClickHouse credentials for Worker consumption
wrangler secret put CLICKHOUSE_HOST --env production
# value: https://projectsites-clickhouse.fly.dev

wrangler secret put CLICKHOUSE_PASSWORD --env production
# value: (same as CLICKHOUSE_PASSWORD set on Fly)
```

### Health Check

```bash
# HTTP API responds on port 8123
curl -u default:<CLICKHOUSE_PASSWORD> \
  "https://projectsites-clickhouse.fly.dev/?query=SELECT+1"
# Expected: 1
```

### Scale

```bash
# Resize VM (current: shared-cpu-2x, 4GB RAM)
fly scale vm performance-2x --app projectsites-clickhouse
```

### Rollback

```bash
fly releases list --app projectsites-clickhouse
# Find the previous release version
fly deploy --image registry.fly.io/projectsites-clickhouse:<previous-version> \
  --app projectsites-clickhouse
```

---

## Chatwoot

### Initial Deploy

```bash
# 1. Create the app
fly apps create projectsites-chatwoot --org personal

# 2. Set Neon database (new database in existing shared project — NOT a new Neon project)
# First run in Neon console: CREATE DATABASE projectsites_chatwoot;
fly secrets set \
  DATABASE_URL="postgres://user:pass@ep-xxx.us-east-1.aws.neon.tech/projectsites_chatwoot?sslmode=require" \
  REDIS_URL="rediss://default:<password>@<host>.upstash.io:6379" \
  SECRET_KEY_BASE="$(openssl rand -hex 64)" \
  MAILER_SENDER_EMAIL="support@projectsites.dev" \
  SMTP_ADDRESS="smtp.resend.com" \
  SMTP_PORT="587" \
  SMTP_USERNAME="resend" \
  SMTP_PASSWORD="<RESEND_API_KEY>" \
  --app projectsites-chatwoot

# 3. Deploy
fly deploy --app projectsites-chatwoot \
  --config apps/chatwoot/fly.toml

# 4. Run Rails migrations
fly ssh console --app projectsites-chatwoot -C "bundle exec rails db:migrate"

# 5. Create superadmin
fly ssh console --app projectsites-chatwoot -C \
  "bundle exec rails c <<< \"SuperAdmin.create!(name: 'Brian', email: 'brian@megabyte.space', password: '<password>')\""
```

### Update/Redeploy

```bash
fly deploy --app projectsites-chatwoot --config apps/chatwoot/fly.toml
```

### Custom Domain

```bash
# Add the custom domain
fly certs add support.projectsites.dev --app projectsites-chatwoot

# Verify certificate issued
fly certs show support.projectsites.dev --app projectsites-chatwoot

# In Cloudflare DNS: add CNAME support.projectsites.dev -> projectsites-chatwoot.fly.dev
# (Proxied = OFF for Fly to handle TLS; OR use CF tunnel for Proxied = ON)
```

### Health Check

```bash
curl -I https://support.projectsites.dev/auth/sign_in
# Expected: HTTP/2 200
```

### Rollback

```bash
fly releases list --app projectsites-chatwoot
fly deploy --image registry.fly.io/projectsites-chatwoot:<previous-version> \
  --app projectsites-chatwoot
```

---

## Monitoring

### Live Logs

```bash
# ClickHouse
fly logs --app projectsites-clickhouse

# Chatwoot (all processes)
fly logs --app projectsites-chatwoot

# Tail with filter
fly logs --app projectsites-chatwoot | grep ERROR
```

### Machine Status

```bash
fly status --app projectsites-clickhouse
fly status --app projectsites-chatwoot
```

### SSH Into a Machine

```bash
fly ssh console --app projectsites-clickhouse
fly ssh console --app projectsites-chatwoot
```

---

## CF Access Protection for Admin Panels

Both Chatwoot and ClickHouse admin interfaces are protected by Cloudflare Access using the `projectsites-infra` service token.

### Service Token Usage

```bash
# Worker-to-service calls include the CF Access service token headers
curl -H "CF-Access-Client-Id: <SERVICE_TOKEN_ID>" \
     -H "CF-Access-Client-Secret: <SERVICE_TOKEN_SECRET>" \
     https://support.projectsites.dev/auth/sign_in
```

> Note: CF Access login pages return HTTP 200 with a login HTML body — not 401/403.
> Always verify access by checking the response body, not just the status code.
> A successful authenticated response has the application content, not the CF Access login form.

### Verifying CF Access Is Active

```bash
# Without token — should see CF Access login page HTML
curl -s https://support.projectsites.dev/auth/sign_in | grep -i "cloudflare access"

# With service token — should see Chatwoot login page
curl -s \
  -H "CF-Access-Client-Id: $CF_SERVICE_TOKEN_ID" \
  -H "CF-Access-Client-Secret: $CF_SERVICE_TOKEN_SECRET" \
  https://support.projectsites.dev/auth/sign_in | grep -i "chatwoot"
```

---

## FLY_API_TOKEN in CI

For CI deployments, set `FLY_API_TOKEN` as a repository secret. The deploy step:

```yaml
# .github/workflows/deploy-fly.yml
- name: Deploy ClickHouse
  env:
    FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
  run: |
    fly deploy --app projectsites-clickhouse \
      --config apps/clickhouse/fly.toml \
      --auto-confirm
```

---

## Related Docs

- [Architecture: CF vs Fly split](./ARCHITECTURE.md)
- [ClickHouse warehouse](./OBSERVABILITY.md)
- [Chatwoot service](./SERVICES-AND-SOCIAL.md)


---

<!-- folded from deployment/verification.md (2026-06-27) -->

# Post-Deploy Verification Playbook

Run these checks after every deployment. Do not declare a deploy complete until all checks pass.

The script `scripts/verify-all-services.sh` automates the curl-based checks (marked with "automated" below). Playwright-based checks require a running browser session.

---

## Verification Checklist

| Check | Command | Expected Result | Automated |
|---|---|---|---|
| Worker health | `curl -sf https://projectsites.dev/health` | HTTP 200, `{"status":"ok"}` | Yes |
| Worker JSON-LD | `curl -s https://projectsites.dev/ \| grep application/ld+json` | JSON-LD present | Yes |
| Marketing homepage | `curl -sf -o /dev/null -w "%{http_code}" https://projectsites.dev/` | `200` | Yes |
| Admin SPA | `curl -sf -o /dev/null -w "%{http_code}" https://projectsites.dev/admin` | `200` | Yes |
| PostHog ingestion | See PostHog section below | Event appears in PostHog | Yes |
| Axiom log ingestion | See Axiom section below | Log line appears in Axiom Play | Yes |
| OTel spans visible | See OTel section below | Spans in Axiom | Manual |
| ClickHouse query | `curl ... "SELECT 1"` | `1` | Yes |
| Chatwoot API | `curl -I https://support.projectsites.dev/auth/sign_in` | HTTP 200 | Yes |
| Postiz API | `curl -I https://social.projectsites.dev/` | HTTP 200 | Yes |
| social.projectsites.dev | `curl -sf -o /dev/null -w "%{http_code}" https://social.projectsites.dev/` | `200` | Yes |
| support.projectsites.dev | `curl -sf -o /dev/null -w "%{http_code}" https://support.projectsites.dev/` | `200` | Yes |
| Editor embed | `curl -sf -o /dev/null -w "%{http_code}" https://editor.projectsites.dev/` | `200` | Yes |
| Site serving (test site) | `curl -sf https://megabytespace.projectsites.dev/` | HTTP 200, site HTML | Yes |
| Security headers | See headers section below | CSP, HSTS, X-Frame-Options present | Yes |

---

## Detailed Checks

### Worker Health

```bash
curl -sf https://projectsites.dev/health
# Expected:
# {"status":"ok","version":"<worker-version>","timestamp":"<iso8601>"}
```

### PostHog Ingestion

Send a test event and verify it appears in PostHog within 30 seconds.

```bash
curl -X POST https://us.i.posthog.com/capture \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "'$POSTHOG_API_KEY'",
    "event": "deploy.verification",
    "distinct_id": "deploy-verify-bot",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "properties": {
      "env": "production",
      "source": "verify-all-services"
    }
  }'
# Expected: HTTP 200, {"status":1}

# Then query in PostHog UI: Events → filter by event = "deploy.verification" (last 5 min)
# Or via PostHog MCP: posthog exec "SELECT count() FROM events WHERE event = 'deploy.verification' AND timestamp > now() - INTERVAL 5 MINUTE"
```

### Axiom Log Ingestion

```bash
curl -X POST "https://api.axiom.co/v1/datasets/${AXIOM_DATASET}/ingest" \
  -H "Authorization: Bearer ${AXIOM_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '[{
    "_time": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "level": "info",
    "service": "project-sites",
    "env": "production",
    "message": "deploy.verification test log",
    "trace_id": "verify-'$(date +%s)'"
  }]'
# Expected: HTTP 200

# Verify in Axiom Play (logs.projectsites.dev):
# ['project-sites-production'] | where message contains "deploy.verification" | where _time >= ago(5m)
```

### OTel Spans Visible

Trigger a real request and check spans appear in Axiom.

```bash
# Make a real request that creates OTel spans
curl -sf https://projectsites.dev/health

# In Axiom Play, query by the CF-Ray header from the response:
# ['project-sites-production'] | where cf_ray == "<ray-id-from-response-header>"
```

### ClickHouse Query

```bash
curl -u "default:${CLICKHOUSE_PASSWORD}" \
  "https://projectsites-clickhouse.fly.dev/?query=SELECT+version()"
# Expected: 24.x.x.x
```

### Chatwoot API Reachable

```bash
curl -I \
  -H "CF-Access-Client-Id: ${CF_SERVICE_TOKEN_ID}" \
  -H "CF-Access-Client-Secret: ${CF_SERVICE_TOKEN_SECRET}" \
  https://support.projectsites.dev/auth/sign_in
# Expected: HTTP/2 200
```

### Postiz API Reachable

```bash
curl -I https://social.projectsites.dev/
# Expected: HTTP/2 200
```

### Security Headers

```bash
curl -sI https://projectsites.dev/ | grep -iE "content-security-policy|strict-transport-security|x-frame-options|x-content-type-options"
# Expected (all must be present):
# strict-transport-security: max-age=31536000; includeSubDomains; preload
# x-frame-options: SAMEORIGIN  (or CSP frame-ancestors)
# x-content-type-options: nosniff
# content-security-policy: (non-empty value)
```

### Site Serving (Test Site)

```bash
curl -sf https://megabytespace.projectsites.dev/
# Expected: HTTP 200, HTML with site content (not blank, not the marketing homepage)

# Verify it is NOT the marketing homepage:
curl -s https://megabytespace.projectsites.dev/ | grep -v "projectsites.dev" | head -5
```

---

## Automated Script

`scripts/verify-all-services.sh` runs all curl-based checks above and exits non-zero if any fail.

```bash
# Run all automated checks
./scripts/verify-all-services.sh

# The script sources get-secret for credentials:
# POSTHOG_API_KEY, AXIOM_API_KEY, AXIOM_DATASET, CLICKHOUSE_PASSWORD,
# CF_SERVICE_TOKEN_ID, CF_SERVICE_TOKEN_SECRET
```

Expected output:
```
[ok] Worker health: {"status":"ok"}
[ok] PostHog ingestion: 200
[ok] Axiom log ingestion: 200
[ok] ClickHouse query: 24.6.x
[ok] Chatwoot API: 200
[ok] Postiz API: 200
[ok] social.projectsites.dev: 200
[ok] support.projectsites.dev: 200
[ok] Site serving (megabytespace): 200
[ok] Security headers: HSTS + CSP present

All checks passed.
```

---

## When a Check Fails

| Failure | First step |
|---|---|
| Worker health 500/503 | `wrangler tail --env production` — look for unhandled exception |
| PostHog ingestion fails | Check `POSTHOG_API_KEY` secret is set: `wrangler secret list --env production` |
| Axiom ingestion fails | Check `AXIOM_API_KEY` and `AXIOM_DATASET` secrets |
| ClickHouse unreachable | `fly status --app projectsites-clickhouse` |
| Chatwoot unreachable | `fly status --app projectsites-chatwoot` + check CF Access policy |
| Site serving 404/500 | Check R2 object exists: `wrangler r2 object get project-sites-production/sites/{slug}/...` |
| Security headers missing | Check `apps/project-sites/src/middleware/security_headers.ts` deployed correctly |

---

## Related Docs

- [Observability overview](./OBSERVABILITY.md)
- [Architecture overview](./ARCHITECTURE.md)
