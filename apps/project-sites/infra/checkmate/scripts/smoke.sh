#!/usr/bin/env bash
# Checkmate smoke test — verifies the deployed app is healthy and serving the login page
# Usage: CHECKMATE_URL=https://monitor.projectsites.dev bash scripts/smoke.sh
set -euo pipefail

CHECKMATE_URL="${CHECKMATE_URL:-https://monitor.projectsites.dev}"
PASS=0
FAIL=0

green() { echo -e "\033[32mPASS\033[0m $1"; ((PASS++)) || true; }
red()   { echo -e "\033[31mFAIL\033[0m $1"; ((FAIL++)) || true; }

echo "=== Checkmate Smoke Test ==="
echo "URL: $CHECKMATE_URL"
echo ""

# --- 1. HTTP status ---
echo -n "→ HTTP status... "
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$CHECKMATE_URL" 2>&1)" || true
if [ "$STATUS" = "200" ]; then
  green "200 OK"
else
  red "got $STATUS (expected 200)"
fi

# --- 2. TLS validity ---
echo -n "→ TLS certificate... "
TLS_INFO="$(curl -sS --max-time 10 -w '%{ssl_verify_result}' -o /dev/null "$CHECKMATE_URL" 2>&1)" || true
if [ "$TLS_INFO" = "0" ]; then
  green "valid"
else
  red "verify result: $TLS_INFO"
fi

# --- 3. Response body looks like Checkmate ---
echo -n "→ Checkmate login/setup page... "
BODY="$(curl -sS --max-time 10 "$CHECKMATE_URL" 2>&1)" || true

# Check for Checkmate indicators in the HTML
if echo "$BODY" | grep -qi 'checkmate\|uptime\|monitor\|login\|signin\|signup\|setup'; then
  green "page contains Checkmate-related content"
else
  # Try looking for the React app root (Checkmate is a React SPA)
  if echo "$BODY" | grep -q '<div id="root"'; then
    green "React SPA shell found"
  else
    red "page does not look like Checkmate (no known indicators found)"
    echo "  First 500 chars: ${BODY:0:500}"
  fi
fi

# --- 4. Health endpoint ---
echo -n "→ Health endpoint... "
HEALTH="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$CHECKMATE_URL/health" 2>&1)" || true
if [ "$HEALTH" = "200" ]; then
  green "200 OK"
else
  red "got $HEALTH (expected 200)"
fi

# --- 5. API reachable (will 401 without auth — that's correct) ---
echo -n "→ API endpoint reachable... "
API_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$CHECKMATE_URL/api/v1/" 2>&1)" || true
if [ "$API_STATUS" = "200" ] || [ "$API_STATUS" = "401" ] || [ "$API_STATUS" = "404" ]; then
  green "status $API_STATUS (API is reachable)"
else
  red "got $API_STATUS (expected 200/401/404)"
fi

# --- 6. Security headers ---
echo -n "→ Security headers (X-Content-Type-Options)... "
HEADERS="$(curl -sI --max-time 10 "$CHECKMATE_URL" 2>&1)" || true
if echo "$HEADERS" | grep -qi 'x-content-type-options: nosniff'; then
  green "nosniff present"
else
  red "X-Content-Type-Options missing"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
