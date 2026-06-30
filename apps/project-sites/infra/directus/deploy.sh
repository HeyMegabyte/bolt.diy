#!/usr/bin/env bash
# Deploy Directus to CF Workers Container + set up directus.projectsites.dev
# Run: bash apps/project-sites/infra/directus/deploy.sh
set -euo pipefail

echo "=== Deploying Directus to directus.projectsites.dev ==="

# Push any uncommitted changes first
cd "$(git rev-parse --show-toplevel)"
git push 2>/dev/null || true

# Auth
export CLOUDFLARE_API_KEY=$(/Users/Apple/.local/bin/get-secret CLOUDFLARE_API_KEY)
export CLOUDFLARE_EMAIL="blzalewski@gmail.com"
export WRANGLER_DOCKER_BIN=/usr/local/bin/docker

cd apps/project-sites/infra/directus

echo "→ Deploying CF Container..."
npx wrangler deploy

echo ""
echo "=== Deploy complete ==="
echo ""
echo "Smoke tests:"
echo "  curl -I https://directus.projectsites.dev/"
echo "  curl https://directus.projectsites.dev/server/ping"
echo ""
echo "Next steps:"
echo "1. Open https://directus.projectsites.dev"
echo "2. Log in with ADMIN_EMAIL / ADMIN_PASSWORD"
echo "3. Verify uploads: upload a file → restart container → verify it persists"
echo "4. Review DEPLOYMENT_NOTES.md and DIRECTUS_RUNBOOK.md"
