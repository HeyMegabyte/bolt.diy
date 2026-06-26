#!/usr/bin/env bash
# verify-postiz.sh — Smoke-test that Postiz is live at social.projectsites.dev.
#
# Exits 0 on success, 1 on any failure.
# Fails immediately if the page contains placeholder/stub text.

set -euo pipefail

TARGET="https://social.projectsites.dev"
TIMEOUT=30

log()  { printf '[verify-postiz] %s\n' "$*" >&2; }
fail() { printf '[verify-postiz] FAIL: %s\n' "$*" >&2; exit 1; }

log "Fetching ${TARGET} ..."

RESPONSE_CODE=$(curl \
  --silent \
  --max-time "${TIMEOUT}" \
  --write-out '%{http_code}' \
  --output /tmp/postiz-verify-body.txt \
  "${TARGET}" \
) || fail "curl failed — is social.projectsites.dev reachable?"

# 1. Assert HTTP 200.
if [[ "${RESPONSE_CODE}" != "200" ]]; then
  fail "Expected HTTP 200, got ${RESPONSE_CODE}"
fi

log "HTTP ${RESPONSE_CODE} OK"

BODY="$(cat /tmp/postiz-verify-body.txt)"

# 2. Assert the page looks like a real Postiz UI (any plausible auth/landing keyword).
if ! printf '%s' "${BODY}" | grep -qiE 'postiz|sign in|login|email'; then
  fail "Response body does not contain expected Postiz keywords (postiz|sign in|login|email)."
fi

log "Content check passed — Postiz UI keywords present."

# 3. Reject placeholder / stub text that would indicate the container isn't running.
PLACEHOLDERS=(
  'Welcome to nginx'
  'It works!'
  'Hello World'
  'Default backend'
  'Container starting'
  '502 Bad Gateway'
  '503 Service Unavailable'
  'under construction'
  'coming soon'
)

for placeholder in "${PLACEHOLDERS[@]}"; do
  if printf '%s' "${BODY}" | grep -qi "${placeholder}"; then
    fail "Response body contains placeholder text: '${placeholder}'. Container may not be running."
  fi
done

log "Placeholder check passed — no stub content detected."
log "PASS — social.projectsites.dev is live and serving Postiz."

rm -f /tmp/postiz-verify-body.txt
