#!/usr/bin/env bash
# Smoke test for grafana.projectsites.dev
# Usage: bash apps/project-sites/infra/grafana/scripts/smoke-grafana.sh
# Fails hard (exit 1) if the login page doesn't return 200 with login-page content.

set -euo pipefail

BASE="${GRAFANA_URL:-https://grafana.projectsites.dev}"
FAILED=0

echo "=== Grafana Smoke Test ==="
echo "Target: $BASE"
echo ""

# 1. Root (/) → should return 200 login page
echo "→ GET /"
ROOT_CODE=$(curl -sS -o /tmp/grafana-root.html -w '%{http_code}' "$BASE/")
echo "   Status: $ROOT_CODE"
if [ "$ROOT_CODE" != "200" ]; then
  echo "   FAIL: expected 200, got $ROOT_CODE"
  FAILED=1
fi
if grep -qiE 'grafana|log in|sign in|login' /tmp/grafana-root.html; then
  echo "   PASS: login page content found"
else
  echo "   FAIL: login page content NOT found in response body"
  FAILED=1
fi
echo ""

# 2. /login → should return 200
echo "→ GET /login"
LOGIN_CODE=$(curl -sS -o /tmp/grafana-login.html -w '%{http_code}' "$BASE/login")
echo "   Status: $LOGIN_CODE"
if [ "$LOGIN_CODE" != "200" ]; then
  echo "   FAIL: expected 200, got $LOGIN_CODE"
  FAILED=1
fi
if grep -qiE 'grafana|log in|sign in|login' /tmp/grafana-login.html; then
  echo "   PASS: login page content found"
else
  echo "   FAIL: login page content NOT found in response body"
  FAILED=1
fi
echo ""

# 3. /api/health → should return 200 with DB OK
echo "→ GET /api/health"
HEALTH_CODE=$(curl -sS -o /tmp/grafana-health.json -w '%{http_code}' "$BASE/api/health")
echo "   Status: $HEALTH_CODE"
if [ "$HEALTH_CODE" != "200" ]; then
  echo "   FAIL: expected 200, got $HEALTH_CODE"
  FAILED=1
else
  echo "   Body: $(cat /tmp/grafana-health.json)"
  if grep -q '"database".*"ok"' /tmp/grafana-health.json 2>/dev/null || grep -q '"database".*"OK"' /tmp/grafana-health.json 2>/dev/null; then
    echo "   PASS: database OK"
  else
    echo "   WARN: database status unclear — check health response above"
  fi
fi
echo ""

# 4. /healthz → custom endpoint
echo "→ GET /healthz"
HZ_CODE=$(curl -sS -o /tmp/grafana-healthz.json -w '%{http_code}' "$BASE/healthz")
echo "   Status: $HZ_CODE"
if [ "$HZ_CODE" != "200" ]; then
  echo "   FAIL: expected 200, got $HZ_CODE"
  FAILED=1
else
  echo "   PASS"
fi
echo ""

# Summary
echo "=== Summary ==="
if [ "$FAILED" -eq 0 ]; then
  echo "✅ ALL CHECKS PASSED — grafana.projectsites.dev is healthy"
else
  echo "❌ SOME CHECKS FAILED — review output above"
fi

exit $FAILED
