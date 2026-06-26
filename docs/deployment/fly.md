# Fly.io Deployment Guide

This guide covers deploying and operating ClickHouse and Chatwoot on Fly.io. For the rationale behind using Fly.io for these services, see [fly-cloudflare-split.md](../architecture/fly-cloudflare-split.md).

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

- [Architecture: CF vs Fly split](../architecture/fly-cloudflare-split.md)
- [ClickHouse warehouse](../analytics/clickhouse.md)
- [Chatwoot service](../services/chatwoot.md)
- [Post-deploy verification](./verification.md)
