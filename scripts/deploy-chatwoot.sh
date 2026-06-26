#!/usr/bin/env bash
# deploy-chatwoot.sh — Deploy the support-chatwoot Fly.io app
#
# Usage:
#   ./scripts/deploy-chatwoot.sh
#   DRY_RUN=1 ./scripts/deploy-chatwoot.sh           # print commands, skip execution
#   ENVIRONMENT=staging ./scripts/deploy-chatwoot.sh
#
# Environment variables:
#   FLY_API_TOKEN         — required; obtain via `flyctl auth token`
#   ENVIRONMENT           — production (default) | staging
#   DRY_RUN               — 1 = echo commands only, no side effects
#   SKIP_DB_PREPARE       — 1 = skip first-boot DB prepare (subsequent deploys)
#
# Required Fly secrets (set once via `flyctl secrets set KEY=value --app support-chatwoot`):
#   SECRET_KEY_BASE       — Rails secret (openssl rand -hex 64)
#   POSTGRES_PASSWORD     — Neon DB password for projectsites_chatwoot
#   REDIS_URL             — Upstash Redis URL (rediss://...)
#   SMTP_ADDRESS          — SMTP host
#   SMTP_USERNAME         — SMTP user / API key
#   SMTP_PASSWORD         — SMTP password / secret
#   MAILER_SENDER_EMAIL   — From address, e.g. support@projectsites.dev

set -euo pipefail

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
readonly APP_NAME="support-chatwoot"
readonly FLY_TOML="infra/fly/support-chatwoot/fly.toml"
readonly ENVIRONMENT="${ENVIRONMENT:-production}"
readonly DRY_RUN="${DRY_RUN:-0}"
readonly SKIP_DB_PREPARE="${SKIP_DB_PREPARE:-0}"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
log() {
  printf '[deploy-chatwoot] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '[DRY_RUN] %s\n' "$*"
  else
    "$@"
  fi
}

checkSecrets() {
  local MISSING=()

  [[ -z "${FLY_API_TOKEN:-}" ]] && MISSING+=("FLY_API_TOKEN")

  # Verify required Fly app secrets are provisioned (list only — never print values)
  if [[ "${DRY_RUN}" != "1" ]] && command -v flyctl >/dev/null 2>&1; then
    local REQUIRED_FLY_SECRETS=(
      "SECRET_KEY_BASE"
      "POSTGRES_PASSWORD"
      "REDIS_URL"
      "SMTP_ADDRESS"
      "SMTP_USERNAME"
      "SMTP_PASSWORD"
      "MAILER_SENDER_EMAIL"
    )
    local PROVISIONED
    PROVISIONED=$(flyctl secrets list --app "${APP_NAME}" --json 2>/dev/null \
      | grep -o '"Name":"[^"]*"' | sed 's/"Name":"//;s/"//' || true)

    for SECRET in "${REQUIRED_FLY_SECRETS[@]}"; do
      if ! echo "${PROVISIONED}" | grep -q "^${SECRET}$"; then
        MISSING+=("Fly secret: ${SECRET}")
      fi
    done
  fi

  if [[ ${#MISSING[@]} -gt 0 ]]; then
    log "Missing required secrets/env vars:"
    for VAR in "${MISSING[@]}"; do
      log "  - ${VAR}"
    done
    die "Resolve missing secrets before deploying."
  fi
}

checkDeps() {
  command -v flyctl >/dev/null 2>&1 || die "'flyctl' not found. Install: https://fly.io/docs/hands-on/install-flyctl/"
}

deploy() {
  log "Deploying ${APP_NAME} (environment=${ENVIRONMENT})..."
  run flyctl deploy \
    --config "${FLY_TOML}" \
    --app "${APP_NAME}" \
    --remote-only \
    --strategy rolling
}

runDbPrepare() {
  if [[ "${SKIP_DB_PREPARE}" == "1" ]]; then
    log "SKIP_DB_PREPARE=1 — skipping db:chatwoot_prepare (subsequent deploy)."
    return
  fi

  log ""
  log "==================================================================="
  log "FIRST-BOOT: Running db:chatwoot_prepare via Fly SSH console..."
  log "  This creates the Chatwoot schema in projectsites_chatwoot (Neon)."
  log "  Set SKIP_DB_PREPARE=1 on subsequent deploys."
  log "==================================================================="
  run flyctl ssh console \
    --app "${APP_NAME}" \
    --command "bundle exec rails db:chatwoot_prepare"
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
main() {
  log "Starting deploy — app=${APP_NAME}, env=${ENVIRONMENT}, dry_run=${DRY_RUN}"

  checkDeps
  checkSecrets
  deploy
  runDbPrepare

  log ""
  log "==================================================================="
  log "POST-DEPLOY CHECKLIST"
  log "==================================================================="
  log "1. Verify: https://support.projectsites.dev  (sign-in page)"
  log "2. Run: ./scripts/verify-chatwoot.sh"
  log "3. Create admin user via Fly console if this is a fresh install:"
  log "   flyctl ssh console --app ${APP_NAME} -C \\"
  log "     'bundle exec rails console <<EOF"
  log "     User.create!(name:\"Admin\", email:\"PLACEHOLDER_EMAIL\","
  log "       password:\"PLACEHOLDER_PASS\", role: :administrator)"
  log "     EOF'"
  log "==================================================================="
  log "Done."
}

main "$@"
