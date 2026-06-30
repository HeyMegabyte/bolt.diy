#!/usr/bin/env bash
# Deploy Lago to CF Workers Container + set up billing.projectsites.dev
# Run: bash apps/project-sites/infra/lago/deploy.sh
set -euo pipefail

echo "=== Deploying Lago to billing.projectsites.dev ==="

# Push any uncommitted changes first
cd "$(git rev-parse --show-toplevel)"
git push 2>/dev/null || true

# Auth
export CLOUDFLARE_API_KEY=$(/Users/Apple/.local/bin/get-secret CLOUDFLARE_API_KEY)
export CLOUDFLARE_EMAIL="blzalewski@gmail.com"
export WRANGLER_DOCKER_BIN=/usr/local/bin/docker

cd apps/project-sites/infra/lago

echo "→ Deploying CF Container..."
npx wrangler deploy

echo ""
echo "=== Deploy complete ==="
echo ""
echo "Next steps:"
echo "1. Open https://billing.projectsites.dev"
echo "2. Create admin account"
echo "3. Settings → API Keys → copy key"
echo "4. Set on main worker:"
echo "   cd apps/project-sites"
echo "   npx wrangler secret put LAGO_API_KEY --env production"
echo "5. Deploy Fly worker (Sidekiq):"
echo "   cd apps/project-sites/infra/lago/fly"
echo "   flyctl deploy"
echo "6. Create 17 billable metrics matching LAGO_BILLABLE_CODE in billing_provider.ts"
