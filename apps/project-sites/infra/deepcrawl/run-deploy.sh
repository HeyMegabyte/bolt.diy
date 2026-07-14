#!/usr/bin/env bash
set -euo pipefail
# Deepcrawl full deployment — sources secrets transiently, deploys all components.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Auth
export CLOUDFLARE_API_KEY=$(/Users/Apple/.local/bin/get-secret CLOUDFLARE_API_KEY)
export CLOUDFLARE_EMAIL="blzalewski@gmail.com"
export CLOUDFLARE_ACCOUNT_ID="84fa0d1b16ff8086dd958c468ce7fd59"

echo "=== Deepcrawl Full Deployment ==="

# 1. Dashboard Container (Next.js + Better Auth)
echo ""
echo "--- Dashboard Container ---"
cd "${SCRIPT_DIR}"
npx wrangler deploy 2>&1

# 2. Firecrawl Bridge
echo ""
echo "--- Firecrawl Bridge ---"
cd "${SCRIPT_DIR}/firecrawl-bridge"
npx wrangler deploy 2>&1

# 3. Verify all endpoints
echo ""
echo "=== Verification ==="
sleep 3

echo -n "Bridge health: "
curl -sf https://firecrawl-bridge.projectsites.dev/health && echo "" || echo "FAIL"

echo -n "Bridge workers.dev: "
curl -sf https://projectsites-deepcrawl-firecrawl-bridge.manhattan.workers.dev/health && echo "" || echo "FAIL"

echo -n "Bridge scrape test: "
curl -sf -X POST https://firecrawl-bridge.projectsites.dev/v1/scrape \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}' && echo "" || echo "FAIL"

echo ""
echo "=== Deploy Complete ==="
echo "Run: bash ${SCRIPT_DIR}/verify.sh"
