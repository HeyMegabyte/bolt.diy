#!/usr/bin/env bash
# Smoke-test Appsmith login page.
# Run after deploy. Exits 0 if the login page renders 200 with expected content.
set -euo pipefail

URL="${APPSMITH_URL:-https://appsmith.projectsites.dev}"
TIMEOUT="${SMOKE_TIMEOUT_SEC:-30}"

echo "==> Smoke-testing Appsmith at $URL"

# 1. Follow redirects, capture final HTTP status
STATUS="$(curl -sSL -o /tmp/appsmith-login.html \
  -w '%{http_code}' \
  --max-time "$TIMEOUT" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36" \
  "$URL" || echo "000")"

echo "--> HTTP status: $STATUS"

# 2. Assert 200
if [ "$STATUS" != "200" ]; then
  echo "FAIL: expected HTTP 200, got $STATUS"
  echo "Response body (first 2KB):"
  head -c 2048 /tmp/appsmith-login.html
  exit 1
fi

# 3. Assert login/sign-in content
if grep -Eiq 'appsmith|sign in|login|email|password|create account' /tmp/appsmith-login.html; then
  echo "PASS: login page detected"
else
  echo "FAIL: login page content not found"
  echo "Response body (first 2KB):"
  head -c 2048 /tmp/appsmith-login.html
  exit 1
fi

# 4. Page size sanity check (must be > 1KB)
SIZE="$(wc -c < /tmp/appsmith-login.html)"
if [ "$SIZE" -lt 1024 ]; then
  echo "FAIL: page too small ($SIZE bytes) — likely an error page"
  exit 1
fi
echo "--> Page size: $SIZE bytes"

echo "==> Smoke test PASSED"
