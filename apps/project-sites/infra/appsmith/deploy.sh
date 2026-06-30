#!/usr/bin/env bash
# Deploy Appsmith to Railway (standard Docker host).
# Fly.io was attempted first but Firecracker VMs are incompatible with
# Appsmith's embedded MongoDB/PostgreSQL/Redis stack.
#
# Prerequisites: railway CLI installed + `railway login`.
set -euo pipefail

IMAGE="${APPSMITH_IMAGE:-appsmith/appsmith-ce:v2.1}"
SERVICE="${RAILWAY_SERVICE:-appsmith}"

echo "==> Deploying Appsmith to Railway"
echo "    Image: $IMAGE"
echo "    Service: $SERVICE"

# 1. Check railway auth
if ! railway whoami >/dev/null 2>&1; then
  echo "--> Not logged in. Run: railway login"
  railway login
fi

# 2. Check required secrets
REQUIRED_SECRETS=("APPSMITH_ENCRYPTION_PASSWORD" "APPSMITH_ENCRYPTION_SALT" "APPSMITH_SUPERVISOR_PASSWORD")
echo "--> Required secrets (set in Railway dashboard → Variables):"
for secret in "${REQUIRED_SECRETS[@]}"; do
  echo "    $secret — $(openssl rand -base64 32 | head -c 20)..."
done

# 3. Deploy
echo "--> Deploying..."
railway up --service "$SERVICE" --detach

echo "==> Deploy initiated"
echo "--> Monitor: railway logs --service $SERVICE"
echo "--> After boot, set up Cloudflare DNS:"
echo "    CNAME appsmith.projectsites.dev → <railway-url> (proxied)"
echo "--> Run smoke test: bash apps/project-sites/infra/appsmith/smoke.sh"
