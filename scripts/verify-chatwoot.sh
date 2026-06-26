#!/usr/bin/env bash
# verify-chatwoot.sh — Smoke-test that support.projectsites.dev is serving Chatwoot
#
# Usage:
#   ./scripts/verify-chatwoot.sh
#   CHATWOOT_URL=https://support.projectsites.dev ./scripts/verify-chatwoot.sh
#
# Exit codes:
#   0 — PASS (Chatwoot is live and serving a recognisable UI)
#   1 — FAIL (wrong status code, placeholder page, or Chatwoot markers absent)

set -euo pipefail

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
readonly CHATWOOT_URL="${CHATWOOT_URL:-https://support.projectsites.dev}"
readonly TMP_BODY="/tmp/cw-verify-$$.html"
readonly TIMEOUT_SECS=15

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
log() {
  printf '[verify-chatwoot] %s\n' "$*" >&2
}

pass() {
  printf '\n\033[0;32m[PASS]\033[0m %s\n' "$*"
}

fail() {
  printf '\n\033[0;31m[FAIL]\033[0m %s\n' "$*" >&2
  exit 1
}

cleanup() {
  rm -f "${TMP_BODY}"
}
trap cleanup EXIT

checkDeps() {
  command -v curl >/dev/null 2>&1 || { log "curl not found"; exit 1; }
  command -v grep >/dev/null 2>&1 || { log "grep not found"; exit 1; }
}

# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------
checkHttpStatus() {
  log "Checking HTTP status for ${CHATWOOT_URL} ..."
  local HTTP_STATUS
  HTTP_STATUS=$(curl \
    --silent \
    --output "${TMP_BODY}" \
    --write-out '%{http_code}' \
    --max-time "${TIMEOUT_SECS}" \
    --location \
    "${CHATWOOT_URL}")

  log "HTTP status: ${HTTP_STATUS}"

  if [[ "${HTTP_STATUS}" != "200" ]]; then
    fail "Expected HTTP 200 but got ${HTTP_STATUS}. URL: ${CHATWOOT_URL}"
  fi
}

checkNotFlyPlaceholder() {
  log "Checking body is not a Fly placeholder / default page..."
  if grep -qiE 'fly\.io|this app is coming soon|launch your app' "${TMP_BODY}"; then
    fail "Response looks like a Fly.io placeholder page — app not yet deployed or DNS not propagated."
  fi
}

checkChatwootMarkers() {
  log "Checking body for Chatwoot UI markers..."
  if grep -qiE 'chatwoot|sign in|sign_in|password|email' "${TMP_BODY}"; then
    log "Chatwoot markers found in response body."
  else
    # Print first 500 chars of body for debugging (no secrets; this is a public sign-in page)
    log "Body excerpt (first 500 chars):"
    head -c 500 "${TMP_BODY}" >&2 || true
    fail "Chatwoot markers not found. The page may be loading a blank SPA shell — re-run after a minute, or check Rails boot logs: flyctl logs --app support-chatwoot"
  fi
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
main() {
  log "Starting Chatwoot smoke test — target: ${CHATWOOT_URL}"

  checkDeps
  checkHttpStatus
  checkNotFlyPlaceholder
  checkChatwootMarkers

  pass "support.projectsites.dev is live and serving Chatwoot. URL: ${CHATWOOT_URL}"
}

main "$@"
