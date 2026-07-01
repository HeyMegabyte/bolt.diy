#!/usr/bin/env bash
set -euo pipefail

ORIGIN="${1:-https://teable.projectsites.dev}"
PASS=0
FAIL=0

check() {
  local label="$1" url="$2" expected="$3"
  local status
  status=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 "$url" 2>/dev/null || echo "000")
  if [ "$status" = "$expected" ]; then
    echo "✅ $label (HTTP $status)"
    PASS=$((PASS + 1))
  else
    echo "❌ $label — expected $expected, got $status"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Teable Health Check: $ORIGIN ==="
echo ""

check "Login page"    "$ORIGIN/"           "200"
check "Health"        "$ORIGIN/_health"    "200"
check "Ready"         "$ORIGIN/_ready"     "200"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

[ "$FAIL" -eq 0 ] && echo "✅ All checks passed!" || echo "❌ Some checks failed"
exit $FAIL
