#!/usr/bin/env bash
# deploy-analytics-ingest.sh — Deploy the analytics-ingest Fly.io app
#
# Usage:
#   ./scripts/deploy-analytics-ingest.sh
#   DRY_RUN=1 ./scripts/deploy-analytics-ingest.sh           # print commands, skip execution
#   ENVIRONMENT=staging ./scripts/deploy-analytics-ingest.sh
#
# Environment variables:
#   FLY_API_TOKEN   — required; obtain via `flyctl auth token`
#   ENVIRONMENT     — production (default) | staging
#   DRY_RUN         — 1 = echo commands only, no side effects
#
# Required Fly secrets (set once via `flyctl secrets set KEY=value --app analytics-ingest`):
#   CLICKHOUSE_URL          — ClickHouse HTTP endpoint
#   CLICKHOUSE_USER         — ClickHouse user
#   CLICKHOUSE_PASSWORD     — ClickHouse password
#   CLICKHOUSE_DATABASE     — ClickHouse target database
#   AXIOM_TOKEN             — Axiom API token
#   AXIOM_DATASET           — Axiom dataset name
#   INGEST_SHARED_SECRET    — Bearer token callers must present

set -euo pipefail

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
readonly APP_NAME="analytics-ingest"
readonly FLY_TOML="infra/fly/analytics-ingest/fly.toml"
readonly ENVIRONMENT="${ENVIRONMENT:-production}"
readonly DRY_RUN="${DRY_RUN:-0}"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
log() {
  printf '[deploy-analytics-ingest] %s\n' "$*" >&2
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

  # Resolve FLY_API_TOKEN via get-secret if not already in env
  if [[ -z "${FLY_API_TOKEN:-}" ]]; then
    if command -v get-secret >/dev/null 2>&1; then
      FLY_API_TOKEN="$(get-secret FLY_API_TOKEN 2>/dev/null || true)"
    fi
  fi

  [[ -z "${FLY_API_TOKEN:-}" ]] && MISSING+=("FLY_API_TOKEN")

  # Verify required Fly app secrets are provisioned (list only — never print values)
  if [[ "${DRY_RUN}" != "1" ]] && command -v flyctl >/dev/null 2>&1 \
     && [[ -z "${MISSING[*]:-}" ]]; then
    local REQUIRED_FLY_SECRETS=(
      "CLICKHOUSE_URL"
      "CLICKHOUSE_USER"
      "CLICKHOUSE_PASSWORD"
      "CLICKHOUSE_DATABASE"
      "AXIOM_TOKEN"
      "AXIOM_DATASET"
      "INGEST_SHARED_SECRET"
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
    log "Missing required secrets/env vars (values not shown):"
    for VAR in "${MISSING[@]}"; do
      log "  - ${VAR}"
    done
    die "Resolve missing secrets before deploying."
  fi
}

checkDeps() {
  command -v flyctl >/dev/null 2>&1 \
    || die "'flyctl' not found. Install: https://fly.io/docs/hands-on/install-flyctl/"
}

deploy() {
  log "Deploying ${APP_NAME} (environment=${ENVIRONMENT})..."
  run flyctl deploy \
    --config "${FLY_TOML}" \
    --app "${APP_NAME}" \
    --remote-only \
    --strategy rolling
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
main() {
  log "Starting deploy — app=${APP_NAME}, env=${ENVIRONMENT}, dry_run=${DRY_RUN}"

  checkDeps
  checkSecrets
  deploy

  log ""
  log "==================================================================="
  log "POST-DEPLOY CHECKLIST"
  log "==================================================================="
  log "1. Verify internal health:  flyctl ssh console --app ${APP_NAME} -C 'wget -qO- http://localhost:8080/health'"
  log "2. Confirm ClickHouse writes (check Fly logs):  flyctl logs --app ${APP_NAME}"
  log "3. Run: ./scripts/verify-observability-cleanup.sh"
  log "==================================================================="
  log "Done."
}

main "$@"
