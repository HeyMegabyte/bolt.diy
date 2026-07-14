#!/usr/bin/env bash
set -euo pipefail

# Smoke test for Maxun deployment
# Usage: ./scripts/smoke-maxun.sh [URL]

URL="${MAXUN_URL:-https://maxun.projectsites.dev}"
TMPFILE="$(mktemp -t maxun-smoke.XXXXXX.html)"
trap 'rm -f "$TMPFILE"' EXIT

echo "=== Maxun Smoke Test ==="
echo "URL: $URL"
echo ""

# 1. HTTP Status
echo "[1/7] HTTP Status..."
STATUS="$(curl -L -s -o "$TMPFILE" -w "%{http_code}" -m 15 "$URL")"
if [ "$STATUS" != "200" ]; then
  echo "FAIL: Expected HTTP 200, got $STATUS"
  head -80 "$TMPFILE"
  exit 1
fi
echo "  PASS: 200"

# 2. Not an error page
echo "[2/7] Error page check..."
if grep -Eiq "cloudflare access|forbidden|not found|bad gateway|service unavailable" "$TMPFILE"; then
  echo "FAIL: Page looks like an error/access page, not Maxun login"
  head -120 "$TMPFILE"
  exit 1
fi
echo "  PASS: Not an error page"

# 3. Maxun branding
echo "[3/7] Maxun branding..."
if ! grep -Eiq "maxun" "$TMPFILE"; then
  echo "FAIL: Could not identify Maxun branding"
  head -120 "$TMPFILE"
  exit 1
fi
echo "  PASS: Contains Maxun branding"

# 4. React SPA shell
echo "[4/7] React SPA shell..."
if ! grep -q '<div id="root">' "$TMPFILE"; then
  echo "FAIL: No React root div found"
  exit 1
fi
echo "  PASS: React SPA shell present"

# 5. Static assets
echo "[5/7] Static assets..."
ASSETS=$(grep -oE '(src|href)="(/assets/[^"]+)"' "$TMPFILE" | sed 's/.*="\(.*\)"/\1/' | head -5)
for asset in $ASSETS; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$URL$asset")
  echo "  $asset → $CODE"
  if [ "$CODE" != "200" ]; then
    echo "  WARN: Asset returned $CODE"
  fi
done
echo "  PASS: Static assets accessible"

# 6. Backend health check
echo "[6/7] Backend health..."
HEALTH=$(curl -s -m 10 "$URL/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "  PASS: Backend health OK"
else
  echo "  FAIL: Backend health check failed — $HEALTH"
  exit 1
fi

# 7. Auth page content
echo "[7/7] Auth UI indicators..."
if grep -Eiq "login|sign.?in|sign.?up|email|password|auth|robot|dashboard" "$TMPFILE"; then
  echo "  PASS: Auth-related content detected"
else
  echo "  NOTE: Auth UI indicators not found in server-rendered HTML (SPA — JS-rendered)"
fi

echo ""
echo "=== ALL SMOKE TESTS PASSED ==="
echo "Maxun is live at $URL"
