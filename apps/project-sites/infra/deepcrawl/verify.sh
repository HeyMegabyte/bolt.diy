#!/usr/bin/env bash
set -euo pipefail
# Verify Deepcrawl deployment at deepcrawl.projectsites.dev
# Run after deploy. Every check must pass.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

check() {
  local label="$1"
  local url="$2"
  local expected="${3:-200}"
  local response
  response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  if [ "$response" = "$expected" ]; then
    echo -e "${GREEN}✓${NC} $label ($response)"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗${NC} $label — expected $expected, got $response"
    FAIL=$((FAIL + 1))
  fi
}

check_body() {
  local label="$1"
  local url="$2"
  local pattern="$3"
  local body
  body=$(curl -s --max-time 10 "$url" 2>/dev/null || echo "")
  if echo "$body" | grep -q "$pattern"; then
    echo -e "${GREEN}✓${NC} $label (found '$pattern')"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗${NC} $label — '$pattern' not found in response"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Deepcrawl Deployment Verification ==="
echo ""

# Dashboard
check      "Dashboard login page"     "https://deepcrawl.projectsites.dev/login" "200"
check_body "Dashboard login renders"   "https://deepcrawl.projectsites.dev/login" "sign"
check      "Dashboard health"         "https://deepcrawl.projectsites.dev/"       "200"

# API Worker (if deployed)
check      "API Worker health"        "https://api.deepcrawl.projectsites.dev/"   "200"

# API read endpoint (requires auth in better-auth mode, expect 401)
check      "API read (auth required)" "https://api.deepcrawl.projectsites.dev/read?url=https://example.com" "401"

# Security checks
echo ""
echo "--- Security ---"
check      "HTTPS enforced (HSTS)"    "https://deepcrawl.projectsites.dev/login" "200"

# Private network blocking
check      "Private IP blocked"       "https://api.deepcrawl.projectsites.dev/read?url=http://127.0.0.1:8080" "400"

echo ""
echo "=== Results ==="
echo -e "${GREEN}Passed: $PASS${NC}"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Failed: $FAIL${NC}"
  exit 1
else
  echo -e "${GREEN}All checks passed!${NC}"
fi
