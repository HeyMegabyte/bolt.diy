#!/usr/bin/env bash
set -euo pipefail
# Deploy Deepcrawl to CF Workers Containers at deepcrawl.projectsites.dev
# Architecture: Dashboard (CF Container, Next.js 16 + integrated Better Auth) +
#               v0 API Worker (native CF Worker at api.deepcrawl.projectsites.dev)
# Stack: CF Containers + CF Workers + D1 + KV + Neon Postgres (auth sessions)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACCOUNT_ID="84fa0d1b16ff8086dd958c468ce7fd59"
ZONE_ID="9ceaa211750dd31899fd5d1bf8d1ec46"
NEON_PROJECT="royal-shape-97525164"
NEON_BRANCH="br-old-leaf-ai01uq85"
NEON_DB="projectsites_deepcrawl"

echo "=== Deepcrawl CF Workers Container Deploy ==="

# 0. Pre-flight
echo "→ Checking prerequisites..."
command -v docker >/dev/null 2>&1 || { echo "Docker required but not found."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm required but not found."; exit 1; }

# Ensure Docker is running
if ! docker info >/dev/null 2>&1; then
  echo "→ Starting Docker..."
  open -a "Docker Desktop" 2>/dev/null || true
  for i in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then echo "  Docker ready."; break; fi
    sleep 2
  done
fi

# 1. Generate secrets (values never printed)
echo "→ Generating secrets..."
BETTER_AUTH_SECRET=$(openssl rand -base64 32)

# 2. Neon Postgres — create database for auth sessions (idempotent)
echo "→ Ensuring Neon database ${NEON_DB}..."
NEON_API_KEY=$(/Users/Apple/.local/bin/get-secret NEON_API_KEY 2>/dev/null || echo "")

if [ -n "${NEON_API_KEY}" ]; then
  NEON_PASSWORD=$(curl -sS \
    "https://console.neon.tech/api/v2/projects/${NEON_PROJECT}/connection_uri?database=${NEON_DB}&role_name=neondb_owner&branch_id=${NEON_BRANCH}" \
    -H "Authorization: Bearer ${NEON_API_KEY}" \
    | python3 -c "import sys,json,urllib.parse; u=json.load(sys.stdin)['uri']; p=urllib.parse.urlparse(u); print(urllib.parse.unquote(p.password))" 2>/dev/null || echo "")

  if [ -z "${NEON_PASSWORD}" ]; then
    echo "  → Creating database ${NEON_DB} via Neon API..."
    curl -sS -X POST \
      "https://console.neon.tech/api/v2/projects/${NEON_PROJECT}/branches/${NEON_BRANCH}/databases" \
      -H "Authorization: Bearer ${NEON_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"database\":{\"name\":\"${NEON_DB}\",\"owner_name\":\"neondb_owner\"}}" > /dev/null 2>&1 || echo "  (database may already exist)"

    NEON_PASSWORD=$(curl -sS \
      "https://console.neon.tech/api/v2/projects/${NEON_PROJECT}/connection_uri?database=${NEON_DB}&role_name=neondb_owner&branch_id=${NEON_BRANCH}" \
      -H "Authorization: Bearer ${NEON_API_KEY}" \
      | python3 -c "import sys,json,urllib.parse; u=json.load(sys.stdin)['uri']; p=urllib.parse.urlparse(u); print(urllib.parse.unquote(p.password))")
  fi

  DATABASE_URL="postgresql://neondb_owner:${NEON_PASSWORD}@c-4.us-east-1.aws.neon.tech:5432/${NEON_DB}?sslmode=require"
  echo "  Database URL ready."
else
  echo "  ⚠️  NEON_API_KEY not available — set DATABASE_URL manually"
  DATABASE_URL=""
fi

# 3. Set wrangler secrets on the dashboard container worker
echo "→ Setting wrangler secrets..."
printf '%s' "${BETTER_AUTH_SECRET}" | wrangler secret put BETTER_AUTH_SECRET --env production 2>&1 | tail -1
if [ -n "${DATABASE_URL}" ]; then
  printf '%s' "${DATABASE_URL}" | wrangler secret put DATABASE_URL --env production 2>&1 | tail -1
fi

# 4. Build Docker image for dashboard
echo "→ Building Dashboard Docker image..."
echo "  This requires the deepcrawl repo. Cloning if needed..."

DEEPCRAWL_DIR="/tmp/deepcrawl-build"
if [ ! -d "${DEEPCRAWL_DIR}" ]; then
  git clone --depth 1 https://github.com/lumpinif/deepcrawl.git "${DEEPCRAWL_DIR}" 2>&1 | tail -1
fi

cd "${DEEPCRAWL_DIR}"
echo "→ Installing dependencies (pnpm)..."
pnpm install --frozen-lockfile 2>&1 | tail -3 || pnpm install --no-frozen-lockfile 2>&1 | tail -3

echo "→ Building Next.js dashboard..."
cd apps/app
NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_APP_URL="https://deepcrawl.projectsites.dev" \
  NEXT_PUBLIC_DEEPCRAWL_API_URL="https://api.deepcrawl.projectsites.dev" \
  NEXT_PUBLIC_USE_AUTH_WORKER="false" \
  BETTER_AUTH_URL="https://deepcrawl.projectsites.dev" \
  AUTH_COOKIE_DOMAIN="projectsites.dev" \
  pnpm build 2>&1 | tail -10

# 5. Deploy Container DO
echo "→ Deploying dashboard container to CF Workers..."
cd "${SCRIPT_DIR}"
wrangler deploy --env production

echo ""
echo "=== Deploy complete ==="
echo "Dashboard: https://deepcrawl.projectsites.dev"
echo ""
echo "Next steps:"
echo "  1. Deploy v0 API Worker from deepcrawl repo:"
echo "     cd ${DEEPCRAWL_DIR}/apps/workers/v0"
echo "     # Edit wrangler.jsonc: change route to api.deepcrawl.projectsites.dev"
echo "     # Update vars: BETTER_AUTH_URL=https://deepcrawl.projectsites.dev"
echo "     wrangler secret put BETTER_AUTH_SECRET --env production"
echo "     wrangler secret put JWT_SECRET --env production"
echo "     wrangler deploy --env production --minify"
echo ""
echo "  2. Add DNS CNAMEs (if not auto-provisioned):"
echo "     deepcrawl.projectsites.dev → projectsites-deepcrawl.projectsites.workers.dev"
echo "     api.deepcrawl.projectsites.dev → deepcrawl-worker-v0.projectsites.workers.dev"
echo ""
echo "  3. Verify:"
echo "     curl -sI https://deepcrawl.projectsites.dev/login | head -1"
echo "     curl -s https://api.deepcrawl.projectsites.dev/ | head -1"
