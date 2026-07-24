#!/usr/bin/env bash
set -euo pipefail

URL="${1:-https://automation.projectsites.dev}"

echo "=== Activepieces Smoke Test ==="
echo "URL: $URL"
echo ""

# 1. HTTP status check
echo "1. HTTP status..."
status="$(curl -sS -o /tmp/activepieces-smoke.html -w '%{http_code}' --max-time 15 "$URL")"
if [ "$status" != "200" ]; then
  echo "FAIL: Expected HTTP 200 but got $status"
  exit 1
fi
echo "   PASS: HTTP $status"

# 2. Login page markers
echo "2. Login page markers..."
if ! grep -Eiq 'activepieces|sign in|login|email|password' /tmp/activepieces-smoke.html; then
  echo "FAIL: Login page markers not found"
  exit 1
fi
echo "   PASS: Login page found"

# 3. TLS valid
echo "3. TLS certificate..."
tls_info="$(curl -sS --max-time 10 -w '%{ssl_verify_result}' -o /dev/null "$URL" 2>&1)"
if [ "$tls_info" != "0" ]; then
  echo "FAIL: TLS verification failed (code: $tls_info)"
  exit 1
fi
echo "   PASS: TLS valid"

# 4. Health endpoint (Activepieces redirects /api/health)
echo "4. API health..."
api_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$URL/api/v1/health" 2>&1 || echo "000")"
echo "   API status: HTTP $api_status (may be 404 if not logged in — non-blocking)"

# 5. Response headers
echo "5. Security headers..."
headers="$(curl -sSI --max-time 10 "$URL" 2>&1)"
if echo "$headers" | grep -qi 'strict-transport-security'; then
  echo "   PASS: HSTS present"
else
  echo "   WARN: HSTS missing"
fi
if echo "$headers" | grep -qi 'x-content-type-options'; then
  echo "   PASS: X-Content-Type-Options present"
else
  echo "   WARN: X-Content-Type-Options missing"
fi

echo ""
echo "=== Smoke test PASSED ==="
echo "Activepieces login page is live at $URL with HTTP 200"
