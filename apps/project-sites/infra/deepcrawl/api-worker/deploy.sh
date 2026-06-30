#!/usr/bin/env bash
set -euo pipefail
# Deploy Deepcrawl v0 API Worker from the deepcrawl monorepo.
# The worker source lives in the deepcrawl repo and depends on internal packages —
# we deploy from within the cloned repo using its pnpm workspace + wrangler.
#
# Usage: bash deploy.sh [--dry-run]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEEPCRAWL_DIR="${DEEPCRAWL_DIR:-/tmp/deepcrawl-build}"
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

# Clone/update the deepcrawl repo
if [ ! -d "${DEEPCRAWL_DIR}" ]; then
  echo "→ Cloning deepcrawl repo..."
  git clone --depth 1 https://github.com/lumpinif/deepcrawl.git "${DEEPCRAWL_DIR}"
fi

cd "${DEEPCRAWL_DIR}"

echo "→ Installing dependencies..."
pnpm install --frozen-lockfile 2>&1 | tail -3 || pnpm install --no-frozen-lockfile 2>&1 | tail -3

# Generate secrets if needed
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 32)}"
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(openssl rand -base64 32)}"

cd apps/workers/v0

echo "→ API Worker configuration:"
echo "    Route: api.deepcrawl.projectsites.dev"
echo "    AUTH_MODE: better-auth"
echo "    BETTER_AUTH_URL: https://deepcrawl.projectsites.dev"

if $DRY_RUN; then
  echo ""
  echo "=== DRY RUN — showing what would happen ==="
  echo "Worker: deepcrawl-worker-v0"
  echo "Route:  api.deepcrawl.projectsites.dev"
  echo "D1:     ${D1_DATABASE_ID:-<will be created>}"
  echo "KV:     ${KV_READ_STORE_ID:-<will be created>}"
  echo "        ${KV_LINKS_STORE_ID:-<will be created>}"
  echo "Secrets: BETTER_AUTH_SECRET, JWT_SECRET"
  echo ""
  echo "=== Run without --dry-run to deploy ==="
  exit 0
fi

# Set secrets
echo "→ Setting wrangler secrets..."
printf '%s' "${BETTER_AUTH_SECRET}" | wrangler secret put BETTER_AUTH_SECRET --env production 2>&1 | tail -1
printf '%s' "${JWT_SECRET}" | wrangler secret put JWT_SECRET --env production 2>&1 | tail -1

# Deploy
echo "→ Deploying API Worker..."
wrangler deploy --env production --minify

echo ""
echo "=== API Worker deployed ==="
echo "URL: https://api.deepcrawl.projectsites.dev"
echo "Health: curl https://api.deepcrawl.projectsites.dev/"
