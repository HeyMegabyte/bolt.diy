#!/usr/bin/env bash
set -euo pipefail

# Deploy Maxun to Fly.io
# Usage: ./deploy.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION="ewr"
BACKEND_APP="projectsites-maxun"
FRONTEND_APP="projectsites-maxun-frontend"
BROWSER_APP="projectsites-maxun-browser"

# ─── Secrets (generated at deploy time, overridable via env) ─────────────────

JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 48)}"
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -base64 48)}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -hex 32)}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-$(openssl rand -hex 32)}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-$(openssl rand -hex 32)}"

# ─── Neon connection (from provisioned database) ────────────────────────────

DB_HOST="${DB_HOST:-ep-twilight-moon-aisscnap-pooler.c-4.us-east-1.aws.neon.tech}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-projectsites_maxun}"
DB_USER="${DB_USER:-neondb_owner}"
DB_PASSWORD="${DB_PASSWORD:-npg_sv6BKlLwUMh8}"
DB_SSL="${DB_SSL:-true}"

# ─── URLs ───────────────────────────────────────────────────────────────────

PUBLIC_URL="${PUBLIC_URL:-https://maxun.projectsites.dev}"
BACKEND_URL="${BACKEND_URL:-https://maxun-api.projectsites.dev}"

echo "=== Deploying Maxun to Fly.io ==="
echo "Public URL:  $PUBLIC_URL"
echo "Backend URL: $BACKEND_URL"
echo ""

# ─── Step 1: Create Fly apps if they don't exist ────────────────────────────

for app in "$BACKEND_APP" "$FRONTEND_APP" "$BROWSER_APP"; do
  if fly apps list 2>/dev/null | grep -q "^$app"; then
    echo "[skip] App $app already exists"
  else
    echo "[create] App $app"
    fly apps create "$app" --org megabyte-labs 2>/dev/null || fly apps create "$app" 2>/dev/null || true
  fi
done

# ─── Step 2: Create volume for MinIO data ───────────────────────────────────

VOLUME_EXISTS=$(fly volumes list -a "$BACKEND_APP" 2>/dev/null | grep -c "minio_data" || true)
if [ "$VOLUME_EXISTS" -eq 0 ]; then
  echo "[create] MinIO volume (1GB) on $BACKEND_APP"
  fly volumes create minio_data --region "$REGION" --size 1 -a "$BACKEND_APP"
fi

# ─── Step 3: Set secrets on backend app ─────────────────────────────────────

echo "[secrets] Setting backend secrets..."
fly secrets set \
  JWT_SECRET="$JWT_SECRET" \
  SESSION_SECRET="$SESSION_SECRET" \
  ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  MINIO_ACCESS_KEY="$MINIO_ACCESS_KEY" \
  MINIO_SECRET_KEY="$MINIO_SECRET_KEY" \
  DB_HOST="$DB_HOST" \
  DB_PORT="$DB_PORT" \
  DB_NAME="$DB_NAME" \
  DB_USER="$DB_USER" \
  DB_PASSWORD="$DB_PASSWORD" \
  DB_SSL="$DB_SSL" \
  PUBLIC_URL="$PUBLIC_URL" \
  BACKEND_URL="$BACKEND_URL" \
  MINIO_ENDPOINT="localhost" \
  MINIO_PORT="9000" \
  MINIO_PUBLIC_URL="$BACKEND_URL/storage" \
  BROWSER_WS_HOST="${BROWSER_APP}.internal" \
  BROWSER_WS_PORT="3001" \
  BROWSER_HEALTH_PORT="3002" \
  BACKEND_PORT="8080" \
  NODE_ENV="production" \
  MAXUN_TELEMETRY="false" \
  -a "$BACKEND_APP"

# ─── Step 4: Set secrets on frontend app ────────────────────────────────────

echo "[secrets] Setting frontend secrets..."
fly secrets set \
  VITE_BACKEND_URL="$BACKEND_URL" \
  VITE_PUBLIC_URL="$PUBLIC_URL" \
  PUBLIC_URL="$PUBLIC_URL" \
  BACKEND_URL="$BACKEND_URL" \
  FRONTEND_PORT="5173" \
  -a "$FRONTEND_APP"

# ─── Step 5: Set secrets on browser app ─────────────────────────────────────

echo "[secrets] Setting browser secrets..."
fly secrets set \
  BROWSER_WS_PORT="3001" \
  BROWSER_HEALTH_PORT="3002" \
  BROWSER_WS_HOST="${BROWSER_APP}.internal" \
  NODE_ENV="production" \
  -a "$BROWSER_APP"

# ─── Step 6: Deploy backend (custom Dockerfile) ─────────────────────────────

echo ""
echo "[deploy] Deploying backend + MinIO..."
cd "$SCRIPT_DIR"
fly deploy \
  --app "$BACKEND_APP" \
  --region "$REGION" \
  --vm-memory 4096 \
  --vm-cpus 2 \
  --volume "minio_data:/data/minio" \
  --env "MINIO_ENDPOINT=localhost" \
  --env "MINIO_PORT=9000" \
  --env "BACKEND_PORT=8080" \
  --env "NODE_ENV=production" \
  .

# ─── Step 7: Deploy frontend (prebuilt image) ───────────────────────────────

echo ""
echo "[deploy] Deploying frontend..."
fly deploy \
  --app "$FRONTEND_APP" \
  --region "$REGION" \
  --image "getmaxun/maxun-frontend:latest" \
  --vm-memory 512 \
  --vm-cpus 1 \
  --env "VITE_BACKEND_URL=$BACKEND_URL" \
  --env "VITE_PUBLIC_URL=$PUBLIC_URL" \
  --env "PUBLIC_URL=$PUBLIC_URL" \
  --env "BACKEND_URL=$BACKEND_URL" \
  --env "FRONTEND_PORT=5173"

# ─── Step 8: Deploy browser (prebuilt image, needs elevated caps) ───────────

echo ""
echo "[deploy] Deploying browser service..."
fly deploy \
  --app "$BROWSER_APP" \
  --region "$REGION" \
  --image "getmaxun/maxun-browser:latest" \
  --vm-memory 2048 \
  --vm-cpus 2 \
  --env "BROWSER_WS_PORT=3001" \
  --env "BROWSER_HEALTH_PORT=3002" \
  --env "BROWSER_WS_HOST=${BROWSER_APP}.internal" \
  --env "NODE_ENV=production"

# ─── Step 9: Allocate IPs ───────────────────────────────────────────────────

for app in "$FRONTEND_APP" "$BACKEND_APP"; do
  if ! fly ips list -a "$app" 2>/dev/null | grep -q "v4"; then
    echo "[ip] Allocating IPv4 for $app"
    fly ips allocate-v4 -a "$app" --shared
  fi
done

# ─── Step 10: Print summary ─────────────────────────────────────────────────

echo ""
echo "=== Deployment complete ==="
echo "Frontend:  https://$FRONTEND_APP.fly.dev"
echo "Backend:   https://$BACKEND_APP.fly.dev"
echo "Browser:   (internal) $BROWSER_APP.internal:3001"
echo ""
echo "Next: Configure DNS records for maxun.projectsites.dev"
echo "Then run: scripts/smoke-maxun.sh"
