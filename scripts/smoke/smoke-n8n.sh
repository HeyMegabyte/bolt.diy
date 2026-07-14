#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${N8N_BASE_URL:-https://automations.projectsites.dev}"

echo "=== n8n Smoke Test ==="
echo "Target: $BASE_URL"
echo ""

# 1. Root URL → 200 + n8n login page
echo "→ Checking root URL..."
HTTP_CODE=$(curl -s -o /tmp/n8n-root.html -w '%{http_code}' "$BASE_URL")
echo "   HTTP $HTTP_CODE"

if [ "$HTTP_CODE" != "200" ]; then
  echo "   FAIL: Expected 200, got $HTTP_CODE"
  exit 1
fi

HTML="$(cat /tmp/n8n-root.html)"
if echo "$HTML" | grep -Eiq 'n8n|signin|sign in|login|setup|owner|email'; then
  echo "   PASS: Login/setup page detected"
else
  echo "   FAIL: Root page did not look like n8n login/setup page"
  echo "   First 500 chars: $(echo "$HTML" | head -c 500)"
  exit 1
fi

# 2. Health endpoint
echo ""
echo "→ Checking /healthz..."
HEALTH_CODE=$(curl -s -o /tmp/n8n-healthz.txt -w '%{http_code}' "$BASE_URL/healthz")
echo "   HTTP $HEALTH_CODE"
if [ "$HEALTH_CODE" = "200" ]; then
  echo "   PASS"
  cat /tmp/n8n-healthz.txt
else
  echo "   WARN: Got $HEALTH_CODE (may not be ready yet)"
fi

# 3. Readiness endpoint
echo ""
echo "→ Checking /healthz/readiness..."
READY_CODE=$(curl -s -o /tmp/n8n-readiness.txt -w '%{http_code}' "$BASE_URL/healthz/readiness")
echo "   HTTP $READY_CODE"
if [ "$READY_CODE" = "200" ]; then
  echo "   PASS"
  cat /tmp/n8n-readiness.txt
else
  echo "   WARN: Got $READY_CODE (DB/Redis may not be connected yet)"
fi

# 4. Security headers
echo ""
echo "→ Checking security headers..."
HEADERS=$(curl -sI "$BASE_URL")
if echo "$HEADERS" | grep -qi 'x-frame-options'; then
  echo "   PASS: X-Frame-Options present"
else
  echo "   INFO: X-Frame-Options not set (n8n default)"
fi

echo ""
echo "=== Smoke test complete ==="
echo "Root: $BASE_URL"
echo "Health: $BASE_URL/healthz"
echo "Readiness: $BASE_URL/healthz/readiness"
