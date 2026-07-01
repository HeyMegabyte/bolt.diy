#!/usr/bin/env bash
# Smoke test for langflow.projectsites.dev
# Run: bash scripts/smoke-langflow.sh
set -euo pipefail

BASE="https://langflow.projectsites.dev"
PASS=0
FAIL=0

check() {
  local label="$1" url="$2" expected="$3" method="${4:-GET}" data="${5:-}"
  local status
  if [ -n "$data" ]; then
    status=$(curl -sS -o /dev/null -w "%{http_code}" -X "$method" -d "$data" -H "Content-Type: application/x-www-form-urlencoded" "$url" 2>&1) || true
  elif [ "$method" != "GET" ]; then
    status=$(curl -sS -o /dev/null -w "%{http_code}" -X "$method" "$url" 2>&1) || true
  else
    status=$(curl -sS -o /dev/null -w "%{http_code}" "$url" 2>&1) || true
  fi
  if echo "$status" | grep -qE "$expected"; then
    echo "✅ $label ($status)"
    PASS=$((PASS + 1))
  else
    echo "❌ $label: got $status, expected $expected"
    FAIL=$((FAIL + 1))
  fi
}

check_body() {
  local label="$1" url="$2" pattern="$3"
  if curl -fsSL "$url" 2>/dev/null | grep -qiE "$pattern"; then
    echo "✅ $label"
    PASS=$((PASS + 1))
  else
    echo "❌ $label: body missing '$pattern'"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Langflow Smoke Test ==="
echo ""

# 1. DNS resolves
if host langflow.projectsites.dev >/dev/null 2>&1; then
  echo "✅ DNS resolves"
  PASS=$((PASS + 1))
else
  echo "❌ DNS does not resolve"
  FAIL=$((FAIL + 1))
fi

# 2. TLS works
if curl -sS -o /dev/null "$BASE/" 2>&1; then
  echo "✅ TLS valid"
  PASS=$((PASS + 1))
else
  echo "❌ TLS check failed"
  FAIL=$((FAIL + 1))
fi

# 3. HTTP 200
check "Homepage 200" "$BASE/" "200"

# 4. Login page content
check_body "Login page has Langflow title" "$BASE/" "langflow"

# 5. API login endpoint exists (POST with bad creds — must return auth failure, not 5xx)
check "API login endpoint" "$BASE/api/v1/login" "403|401|400|422" "POST" "username=invalid&password=invalid"

# 6. Health check (Langflow doesn't have /health, use /api/v1/version)
check_body "API version endpoint" "$BASE/api/v1/version" "version|package"

echo ""
echo "=== Results ==="
echo "Pass: $PASS"
echo "Fail: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SMOKE TEST: PASS ✅"
  exit 0
else
  echo "SMOKE TEST: FAIL ❌"
  exit 1
fi
