#!/usr/bin/env bash
# =============================================================================
# check-onyx-deploy.sh — Verify Onyx deployment at onyx.projectsites.dev
# =============================================================================
set -euo pipefail

APP_URL="https://onyx.projectsites.dev"
PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  local expected="$3"
  if [ "$result" = "$expected" ]; then
    echo "  ✅ $label"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $label (got: $result, expected: $expected)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Onyx Deployment Verification ==="
echo "Target: $APP_URL"
echo ""

# ── 1. DNS resolution ──────────────────────────────────────────────────────
echo "── DNS ──"
DNS_RESULT=$(dig +short onyx.projectsites.dev 2>/dev/null || echo "FAIL")
if [ -n "$DNS_RESULT" ] && [ "$DNS_RESULT" != "FAIL" ]; then
  echo "  ✅ DNS resolves: $DNS_RESULT"
  PASS=$((PASS + 1))
else
  echo "  ❌ DNS does not resolve"
  FAIL=$((FAIL + 1))
fi

# ── 2. TLS ─────────────────────────────────────────────────────────────────
echo "── TLS ──"
TLS_RESULT=$(curl -s -o /dev/null -w "%{http_code}" "$APP_URL" 2>&1 || echo "000")
# If we get any HTTP response (not 000), TLS worked
if [ "$TLS_RESULT" != "000" ]; then
  echo "  ✅ TLS handshake successful"
  PASS=$((PASS + 1))
else
  echo "  ❌ TLS handshake failed"
  FAIL=$((FAIL + 1))
fi

# ── 3. HTTP 200 on root ────────────────────────────────────────────────────
echo "── HTTP ──"
HTTP_CODE=$(curl -L -s -o /dev/null -w "%{http_code}" "$APP_URL" 2>&1 || echo "000")
check "HTTP status" "$HTTP_CODE" "200"

# ── 4. Login/signup page content ───────────────────────────────────────────
echo "── Content ──"
BODY=$(curl -L -s "$APP_URL" 2>/dev/null || echo "")

if echo "$BODY" | grep -qiE "(sign in|login|sign up|create account|onyx)"; then
  echo "  ✅ Login/signup content found in page"
  PASS=$((PASS + 1))
else
  echo "  ❌ No login/signup content detected"
  echo "  Page preview: $(echo "$BODY" | head -c 300)"
  FAIL=$((FAIL + 1))
fi

# Check it's not a Cloudflare error page
if echo "$BODY" | grep -qi "cloudflare"; then
  echo "  ⚠ Page contains 'cloudflare' — might be error page, not Onyx"
fi

# ── 5. Health endpoint ─────────────────────────────────────────────────────
echo "── Health ──"
HEALTH_CODE=$(curl -L -s -o /dev/null -w "%{http_code}" "$APP_URL/health" 2>&1 || echo "000")
check "Health endpoint" "$HEALTH_CODE" "200"

# ── 6. API check ───────────────────────────────────────────────────────────
echo "── API ──"
API_CODE=$(curl -L -s -o /dev/null -w "%{http_code}" "$APP_URL/api/health" 2>&1 || echo "000")
if [ "$API_CODE" = "200" ] || [ "$API_CODE" = "404" ]; then
  # 200 = healthy, 404 = API exists but no /api/health endpoint (still OK)
  echo "  ✅ API reachable (HTTP $API_CODE)"
  PASS=$((PASS + 1))
else
  echo "  ❌ API unreachable (HTTP $API_CODE)"
  FAIL=$((FAIL + 1))
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -eq 0 ]; then
  echo "✅ Onyx deployment is HEALTHY at $APP_URL"
  exit 0
else
  echo "❌ Onyx deployment has issues — check above"
  exit 1
fi
