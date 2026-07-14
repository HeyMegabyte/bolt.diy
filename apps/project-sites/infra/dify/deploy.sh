#!/usr/bin/env bash
# Dify @ dify.projectsites.dev — Deploy Script
# Usage: ./deploy.sh [--skip-fly] [--skip-worker] [--secrets-only]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Secrets provisioning ───────────────────────────────────────────────────
echo "=== Setting Fly secrets ==="

# Neon Postgres (non-pooling for migrations, pooling for runtime)
flyctl secrets set -a dify \
  DB_TYPE=postgresql \
  DB_HOST=ep-round-wildflower-aigybxdk.c-4.us-east-1.aws.neon.tech \
  DB_PORT=5432 \
  DB_USERNAME=neondb_owner \
  DB_PASSWORD=npg_wEsrfOcpW3M4 \
  DB_DATABASE=projectsites_dify \
  SECRET_KEY="$(get-secret DIFY_SECRET_KEY)" \
  CONSOLE_API_URL=https://dify.projectsites.dev/console/api \
  CONSOLE_WEB_URL=https://dify.projectsites.dev \
  SERVICE_API_URL=https://dify.projectsites.dev/api \
  APP_API_URL=https://dify.projectsites.dev/v1 \
  APP_WEB_URL=https://dify.projectsites.dev \
  DEPLOY_ENV=PRODUCTION

# Upstash Redis
flyctl secrets set -a dify \
  REDIS_HOST=relaxing-aphid-155781.upstash.io \
  REDIS_PORT=6379 \
  REDIS_USERNAME=default \
  REDIS_PASSWORD="$(get-secret DIFY_REDIS_PASSWORD)" \
  REDIS_USE_SSL=true

# R2 (set manually after creating token at dash.cloudflare.com → R2)
# flyctl secrets set -a dify \
#   STORAGE_TYPE=s3 \
#   S3_ENDPOINT=https://84fa0d1b16ff8086dd958c468ce7fd59.r2.cloudflarestorage.com \
#   S3_BUCKET_NAME=projectsites-dify \
#   S3_ACCESS_KEY=<r2-access-key> \
#   S3_SECRET_KEY=<r2-secret-key> \
#   S3_REGION=auto

# Weaviate (set manually after creating at console.weaviate.cloud)
# flyctl secrets set -a dify \
#   VECTOR_STORE=weaviate \
#   WEAVIATE_ENDPOINT=https://<cluster-id>.weaviate.network \
#   WEAVIATE_API_KEY=<weaviate-key>

# Internal services (Fly private network)
flyctl secrets set -a dify \
  CODE_EXECUTION_ENDPOINT=http://dify-sandbox.internal:8194 \
  CODE_EXECUTION_API_KEY=dify-sandbox \
  PLUGIN_DAEMON_URL=http://dify-plugin.internal:5003 \
  PLUGIN_DAEMON_KEY="$(get-secret DIFY_PLUGIN_DAEMON_KEY)" \
  SSRF_PROXY_HTTP_URL= \
  SSRF_PROXY_HTTPS_URL=

echo "=== Secrets set ==="

# ── Deploy Cloudflare Worker ───────────────────────────────────────────────
echo "=== Deploying Cloudflare Worker ==="
export CLOUDFLARE_API_TOKEN="$(get-secret CLOUDFLARE_API_TOKEN)"
export CLOUDFLARE_ACCOUNT_ID=84fa0d1b16ff8086dd958c468ce7fd59
npx wrangler deploy

# ── Deploy Fly Apps ────────────────────────────────────────────────────────
echo "=== Deploying Fly apps ==="

# API + Worker + Beat (main app)
flyctl deploy -c fly.toml --ha=false
flyctl scale count api=1 worker=1 beat=1 -a dify

# Web frontend
flyctl deploy -c fly.web.toml --ha=false

# Sandbox
flyctl deploy -c fly.sandbox.toml --ha=false

# Plugin Daemon
flyctl deploy -c fly.plugin.toml --ha=false

# ── Run migrations + create admin ──────────────────────────────────────────
echo "=== Running migrations ==="
flyctl ssh console -a dify -C "flask db upgrade" || echo "⚠️  Migrations may need to be run manually"

echo "=== Done ==="
echo ""
echo "Smoke test:"
echo "  curl -i https://dify.projectsites.dev/health"
echo "  curl -i https://dify.projectsites.dev/apps"
echo ""
echo "Create admin (if needed):"
echo "  flyctl ssh console -a dify -C 'flask create-account --email admin@projectsites.dev --name Admin --password <password>'"
