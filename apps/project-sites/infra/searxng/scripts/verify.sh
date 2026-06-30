#!/usr/bin/env bash
set -euo pipefail

# SearXNG verification script — ProjectSites.dev
# Run after deploy to confirm search.projectsites.dev is healthy.

HOST="${HOST:-https://search.projectsites.dev}"

echo "=== SearXNG Verification ==="
echo "Host: $HOST"
echo ""

# ── Health check (Worker-level, no engine calls) ───────────────────────
echo "1. Health check (/healthz → 200 ok)..."
HEALTH=$(curl -fsS -w '\n%{http_code}' "$HOST/healthz")
HEALTH_CODE=$(echo "$HEALTH" | tail -1)
HEALTH_BODY=$(echo "$HEALTH" | sed '$d')
if [[ "$HEALTH_CODE" == "200" && "$HEALTH_BODY" == "ok" ]]; then
  echo "   ✓ PASS — $HEALTH_CODE $HEALTH_BODY"
else
  echo "   ✗ FAIL — got $HEALTH_CODE: $HEALTH_BODY"
  exit 1
fi

# ── Unauthenticated Access check ───────────────────────────────────────
echo ""
echo "2. Access login wall (unauthenticated GET /)..."
ACCESS_RESPONSE=$(curl -sI "$HOST" 2>&1)
ACCESS_CODE=$(echo "$ACCESS_RESPONSE" | head -1 | awk '{print $2}')
echo "   HTTP status: $ACCESS_CODE"

# CF Access serves a login page (200) or redirects to login.
# A direct SearXNG HTML page without Access would mean the wall is missing.
if [[ "$ACCESS_CODE" == "200" || "$ACCESS_CODE" == "302" || "$ACCESS_CODE" == "301" ]]; then
  # Check for CF Access indicators in response headers
  if echo "$ACCESS_RESPONSE" | grep -qi 'cf-access\|cloudflare-access\|cf-chl-'; then
    echo "   ✓ PASS — CF Access gate detected"
  elif [[ "$ACCESS_CODE" == "302" || "$ACCESS_CODE" == "301" ]]; then
    # Follow the redirect to confirm it lands on a 200 login page
    REDIRECT_URL=$(echo "$ACCESS_RESPONSE" | grep -i '^location:' | head -1 | sed 's/^[Ll]ocation: *//' | tr -d '\r')
    if [[ -n "$REDIRECT_URL" ]]; then
      REDIRECT_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$REDIRECT_URL")
      if [[ "$REDIRECT_CODE" == "200" ]]; then
        echo "   ✓ PASS — redirect $ACCESS_CODE → $REDIRECT_URL → 200"
      else
        echo "   ⚠ Redirect target returned $REDIRECT_CODE (may still be valid Access flow)"
      fi
    else
      echo "   ⚠ No redirect target found — verify Access is configured at:"
      echo "     https://one.dash.cloudflare.com/ → Access → Applications"
    fi
  else
    echo "   ⚠ No CF Access header detected. Verify Access is configured at:"
    echo "     https://one.dash.cloudflare.com/ → Access → Applications"
  fi
else
  echo "   ✗ FAIL — unexpected status $ACCESS_CODE"
fi

# ── Service token auth check (if credentials available) ────────────────
echo ""
echo "3. Service token JSON search (if configured)..."
if [[ -n "${CF_ACCESS_CLIENT_ID:-}" && -n "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
  JSON_CODE=$(curl -fsS -o /dev/null -w '%{http_code}' \
    -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
    -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
    "$HOST/search?q=projectsites&format=json" 2>&1 || echo "000")
  if [[ "$JSON_CODE" == "200" ]]; then
    echo "   ✓ PASS — JSON search 200"
  else
    echo "   ✗ FAIL — JSON search returned $JSON_CODE"
  fi
else
  echo "   ⊘ SKIP — CF_ACCESS_CLIENT_ID/SECRET not set"
  echo ""
  echo "   To test authenticated search, set env vars and re-run:"
  echo "   export CF_ACCESS_CLIENT_ID=<service-token-client-id>"
  echo "   export CF_ACCESS_CLIENT_SECRET=<service-token-client-secret>"
  echo "   bash scripts/verify.sh"
fi

# ── Summary ────────────────────────────────────────────────────────────
echo ""
echo "=== Verification Complete ==="
echo "Manual checks remaining:"
echo "  • Open $HOST in a browser → should see CF Access login"
echo "  • Authenticate → should see SearXNG search page"
echo "  • Run a test search → results should appear"
echo "  • Cloudflare Access configured at:"
echo "    https://one.dash.cloudflare.com/ → Access → Applications → ProjectSites SearXNG"
