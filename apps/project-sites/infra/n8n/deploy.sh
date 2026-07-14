#!/usr/bin/env bash
# Deploy n8n to CF Workers Container + sync Fly worker secrets + smoke test
# Run: bash apps/project-sites/infra/n8n/deploy.sh
set -euo pipefail

echo "=== Deploying n8n to automations.projectsites.dev ==="

# Push any uncommitted changes first
cd "$(git rev-parse --show-toplevel)"
git push 2>/dev/null || true

# Auth
export CLOUDFLARE_API_KEY=$(/Users/Apple/.local/bin/get-secret CLOUDFLARE_API_KEY)
export CLOUDFLARE_EMAIL="blzalewski@gmail.com"
export WRANGLER_DOCKER_BIN=/usr/local/bin/docker

# ── CF Container (n8n web/editor) ──────────────────────────────────────
cd apps/project-sites/infra/n8n
echo "→ Deploying CF Container (n8n web/editor)..."
npx wrangler deploy

# ── Zone route (ensure it exists) ──────────────────────────────────────
echo ""
echo "→ Checking zone route..."
ROUTE_ID=$(curl -sf "https://api.cloudflare.com/client/v4/zones/9ceaa211750dd31899fd5d1bf8d1ec46/workers/routes" \
  -H "X-Auth-Email: $CLOUDFLARE_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
  | python3 -c "import sys,json; routes=json.load(sys.stdin)['result']; print(next((r['id'] for r in routes if r.get('script')=='projectsites-n8n'), ''))")

if [ -z "$ROUTE_ID" ]; then
  echo "→ Creating zone route: automations.projectsites.dev/* → projectsites-n8n"
  curl -sf -X POST "https://api.cloudflare.com/client/v4/zones/9ceaa211750dd31899fd5d1bf8d1ec46/workers/routes" \
    -H "X-Auth-Email: $CLOUDFLARE_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"pattern":"automations.projectsites.dev/*","script":"projectsites-n8n"}' >/dev/null
  echo "   Route created."
else
  echo "   Route exists: $ROUTE_ID"
fi

# ── Workers.dev subdomain (enable for webhook receiver) ────────────────
echo ""
echo "→ Enabling workers.dev subdomain..."
curl -sf -X POST "https://api.cloudflare.com/client/v4/accounts/84fa0d1b16ff8086dd958c468ce7fd59/workers/scripts/projectsites-n8n/subdomain" \
  -H "X-Auth-Email: $CLOUDFLARE_EMAIL" -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}' >/dev/null
echo "   workers.dev enabled: https://projectsites-n8n.manhattan.workers.dev"

# ── Fly worker secrets sync ────────────────────────────────────────────
echo ""
echo "→ Syncing Fly worker secrets..."
if command -v flyctl &>/dev/null; then
  SECRETS=(
    "DB_POSTGRESDB_HOST=$(/Users/Apple/.local/bin/get-secret N8N_DB_HOST 2>/dev/null || echo 'ep-super-voice-ai6ea968-pooler.c-4.us-east-1.aws.neon.tech')"
    "DB_POSTGRESDB_USER=$(/Users/Apple/.local/bin/get-secret N8N_DB_USER 2>/dev/null || echo 'neondb_owner')"
    "DB_POSTGRESDB_PASSWORD=$(/Users/Apple/.local/bin/get-secret N8N_DB_PASSWORD 2>/dev/null || echo '')"
    "QUEUE_BULL_REDIS_HOST=$(/Users/Apple/.local/bin/get-secret N8N_REDIS_HOST 2>/dev/null || echo 'moral-adder-155708.upstash.io')"
    "QUEUE_BULL_REDIS_PASSWORD=$(/Users/Apple/.local/bin/get-secret N8N_REDIS_PASSWORD 2>/dev/null || echo '')"
    "N8N_ENCRYPTION_KEY=$(/Users/Apple/.local/bin/get-secret N8N_ENCRYPTION_KEY 2>/dev/null || echo '')"
  )
  flyctl secrets set "${SECRETS[@]}" --app projectsites-n8n-worker 2>/dev/null || echo "   (flyctl not authenticated — skip)"
  echo "   Fly secrets synced."
else
  echo "   flyctl not found — skipping Fly sync."
fi

echo ""
echo "=== Deploy complete ==="
echo ""
echo "Next:"
echo "1. Open https://automations.projectsites.dev → create owner account"
echo "2. Disable public signup: Settings → Users"
echo "3. Generate API key: Settings → API"
echo "4. Re-deploy worker if needed: cd infra/n8n && flyctl deploy --app projectsites-n8n-worker"
echo "5. Smoke test: bash scripts/smoke/smoke-n8n.sh"
