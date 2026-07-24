#!/usr/bin/env bash
set -euo pipefail
# Verify Deepcrawl + Firecrawl Bridge deployment

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
PASS=0; FAIL=0

check() {
  local label="$1" url="$2" expected="${3:-200}"
  local response
  response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  if [ "$response" = "$expected" ]; then
    echo -e "${GREEN}✓${NC} $label ($response)"; PASS=$((PASS + 1))
  else
    echo -e "${RED}✗${NC} $label — expected $expected, got $response"; FAIL=$((FAIL + 1))
  fi
}

check_body() {
  local label="$1" url="$2" pattern="$3"
  local body
  body=$(curl -s --max-time 10 "$url" 2>/dev/null || echo "")
  if echo "$body" | grep -q "$pattern"; then
    echo -e "${GREEN}✓${NC} $label (found '$pattern')"; PASS=$((PASS + 1))
  else
    echo -e "${RED}✗${NC} $label — '$pattern' not found"; FAIL=$((FAIL + 1))
  fi
}

check_json() {
  local label="$1" url="$2" field="$3"
  local val
  val=$(curl -s --max-time 10 "$url" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$field',''))" 2>/dev/null || echo "")
  if [ -n "$val" ] && [ "$val" != "null" ]; then
    echo -e "${GREEN}✓${NC} $label ($field=$val)"; PASS=$((PASS + 1))
  else
    echo -e "${RED}✗${NC} $label — field '$field' missing"; FAIL=$((FAIL + 1))
  fi
}

echo "=== Deepcrawl + Firecrawl Bridge Verification ==="
echo ""

echo "--- Dashboard ---"
check      "Login page 200"           "https://deepcrawl.projectsites.dev/login" "200"
check_body "Login renders sign-in"    "https://deepcrawl.projectsites.dev/login" "sign"
check      "Dashboard /"              "https://deepcrawl.projectsites.dev/" "200"

echo "--- API Worker ---"
check      "API health"               "https://api.deepcrawl.projectsites.dev/" "200"
check_json "API health JSON"          "https://api.deepcrawl.projectsites.dev/" "message"
check      "Read endpoint (auth 401)" "https://api.deepcrawl.projectsites.dev/read?url=https://example.com" "401"

echo "--- Firecrawl Bridge ---"
check      "Bridge health"            "https://firecrawl-bridge.projectsites.dev/health" "200"
check_json "Bridge health JSON"       "https://firecrawl-bridge.projectsites.dev/health" "status"

echo "--- Security ---"
check      "HTTPS enforced"           "https://deepcrawl.projectsites.dev/login" "200"
check      "Private IP blocked"       "https://api.deepcrawl.projectsites.dev/read?url=http://127.0.0.1:8080" "400"

echo ""
echo "=== Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC} ==="
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
