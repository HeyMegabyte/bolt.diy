#!/usr/bin/env bash
# Smoke test: AnythingLLM at anything.projectsites.dev
# Asserts HTTP 200 + login/setup UI markers in response body.
set -euo pipefail

HOSTNAME="${1:-anything.projectsites.dev}"
URL="https://${HOSTNAME}/"

echo "=== AnythingLLM Smoke Test ==="
echo "Target: $URL"
echo ""

# 1. HTTP status
echo "→ Checking HTTP status..."
STATUS=$(curl -fsSL -o /tmp/anythingllm-smoke.html -w '%{http_code}' "$URL" 2>/tmp/anythingllm-smoke-err.log)
if [ "$STATUS" != "200" ]; then
  echo "FAIL: HTTP $STATUS (expected 200)"
  cat /tmp/anythingllm-smoke-err.log 2>/dev/null || true
  exit 1
fi
echo "  PASS: HTTP $STATUS"

# 2. Check for login/setup UI markers
echo "→ Checking for login/setup UI..."
BODY=$(cat /tmp/anythingllm-smoke.html)
FOUND=0
for MARKER in "AnythingLLM" "login" "password" "Sign in" "Welcome" "setup" "create-account"; do
  if echo "$BODY" | grep -qi "$MARKER"; then
    echo "  PASS: Found marker '$MARKER'"
    FOUND=1
    break
  fi
done

if [ "$FOUND" = "0" ]; then
  echo "FAIL: No login/setup UI markers found in response body"
  echo "First 500 chars:"
  echo "$BODY" | head -c 500
  exit 1
fi

# 3. Check security headers
echo "→ Checking security headers..."
HEADERS=$(curl -sI "$URL" 2>/dev/null)
if echo "$HEADERS" | grep -qi 'x-content-type-options: nosniff'; then
  echo "  PASS: X-Content-Type-Options: nosniff"
else
  echo "  WARN: X-Content-Type-Options missing"
fi

echo ""
echo "=== Smoke test PASSED ==="
echo "URL: $URL"
echo "Status: $STATUS"
