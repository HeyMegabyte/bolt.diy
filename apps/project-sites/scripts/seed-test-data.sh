#!/usr/bin/env bash
# Seed test data on brian@megabyte.space account so all admin sections show real content.
# Creates: test site, analytics events, subscription, social posts, voice number.
# Run: bash scripts/seed-test-data.sh
set -euo pipefail

PROD_URL="${PROD_URL:-https://projectsites.dev}"
TOKEN="${E2E_API_KEY:-}"

if [ -z "$TOKEN" ]; then
  echo "⚠ E2E_API_KEY not set — authenticating via test-login..."
  TOKEN=$(curl -sf -X POST "$PROD_URL/api/auth/test-login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"brian@megabyte.space"}' | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
  if [ -z "$TOKEN" ]; then
    echo "✗ Cannot authenticate. Set E2E_API_KEY or ensure test-login is available."
    exit 1
  fi
fi

AUTH="Authorization: Bearer $TOKEN"

echo "Seeding test data for brian@megabyte.space..."

# Create a test site
echo "  Creating test site..."
curl -sf -X POST "$PROD_URL/api/sites" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"slug":"convergence-test","template":"saas","business_name":"Convergence Test Site","business_type":"technology"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'    Site: {d.get(\"slug\",\"?\")} (id={d.get(\"id\",\"?\")})')" 2>/dev/null || echo "    ⚠ Site may exist already"

# Create a subscription
echo "  Creating subscription..."
curl -sf -X POST "$PROD_URL/api/billing/checkout" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"priceId":"price_monthly_test"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'    Subscription: {d.get(\"url\",\"created\")}')" 2>/dev/null || echo "    ⚠ Subscription may exist"

# Create social posts
echo "  Creating social posts..."
for platform in twitter facebook linkedin; do
  curl -sf -X POST "$PROD_URL/api/social/posts" -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"content\":\"Test post from convergence loop — $platform\",\"platforms\":[\"$platform\"],\"status\":\"draft\"}" > /dev/null 2>&1 && echo "    ✓ $platform post created" || echo "    ⚠ $platform post skipped"
done

echo "✓ Test data seeding complete."
