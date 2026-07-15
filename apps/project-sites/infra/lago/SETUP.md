# Lago Setup — billing.projectsites.dev

Lago is deployed on Fly.io (`projectsites-lago`). The Fly app exists but needs
secrets configured. Currently returns 403 because no admin account exists and
auth is unconfigured.

## What's missing

The `fly.toml` has the app structure. Secrets were never set — all env vars were
PLACEHOLDERs. Here's what needs to happen:

## 1. Provision backing services

```bash
# Neon Postgres — create a database for Lago
# (reuse the existing Neon project, create a new DB)
psql postgresql://<neon-url> -c "CREATE DATABASE projectsites_lago"

# Redis — reuse the shared Fly Redis (already running at 168.220.90.239)
# Lago gets its own DB number (e.g. /2)
LAGO_REDIS_URL="redis://168.220.90.239:6379/2"

# ClickHouse — already running at ch.projectsites.dev (Dittofeed + Langfuse share it)
# Get the password from get-secret CLICKHOUSE_PASSWORD
```

## 2. Set all secrets on Fly

```bash
# Generate admin credentials
ADMIN_PASSWORD=$(openssl rand -base64 16)
SECRET_KEY=$(openssl rand -hex 64)
echo "Admin password: $ADMIN_PASSWORD"  # save this!

# Set Fly secrets
fly secrets set \
  LAGO_DATABASE_URL="postgresql://..." \
  LAGO_REDIS_URL="redis://168.220.90.239:6379/2" \
  LAGO_CLICKHOUSE_PASSWORD="$(get-secret CLICKHOUSE_PASSWORD)" \
  LAGO_SECRET_KEY="$SECRET_KEY" \
  LAGO_ADMIN_EMAIL="admin@megabyte.space" \
  LAGO_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  GOOGLE_CLIENT_ID="$(get-secret GOOGLE_CLIENT_ID)" \
  GOOGLE_CLIENT_SECRET="$(get-secret GOOGLE_CLIENT_SECRET)"
```

## 3. Deploy

```bash
fly deploy -c infra/lago/fly.toml
```

## 4. Verify

```bash
# Should return 200 (not 403)
curl https://billing.projectsites.dev/health

# Sign in at https://billing.projectsites.dev
# Email: admin@megabyte.space
# Password: (generated above)
```

## 5. Wire into ProjectSites

```bash
cd apps/project-sites
npx wrangler secret put LAGO_API_KEY --env production  # = LAGO_SECRET_KEY from above
npx wrangler secret put LAGO_API_URL --env production  # = https://billing.projectsites.dev/api/v1
npx wrangler secret put BILLING_PROVIDER --env production  # = lago
```

## Architecture

```
billing.projectsites.dev (Fly.io)
  ├── Lago API (ghcr.io/getlago/api:latest) — Rails, port 3000
  ├── Neon Postgres (projectsites_lago) — system of record
  ├── Fly Redis (shared, DB /2) — Sidekiq job queue
  └── ClickHouse (ch.projectsites.dev) — analytics/events

ProjectSites Worker
  └── billing_provider_lago.ts → LAGO_API_URL → Lago API
      → 17 billable metrics → D1 ledger → Stripe payment collection
```

## OAuth IDs

Google OAuth is preferred — use the existing PROJECTSITES Google OAuth app
so admins sign in with their @megabyte.space accounts. Set `GOOGLE_CLIENT_ID`
and `GOOGLE_CLIENT_SECRET` from get-secret.

Without Google OAuth, use the admin email/password set via fly secrets.
