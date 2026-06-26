#!/usr/bin/env bash
# deploy-clickhouse.sh — Deploy the analytics-clickhouse Fly.io app
#
# Usage:
#   ./scripts/deploy-clickhouse.sh
#   DRY_RUN=1 ./scripts/deploy-clickhouse.sh          # print commands, skip execution
#   ENVIRONMENT=staging ./scripts/deploy-clickhouse.sh
#
# Environment variables:
#   FLY_API_TOKEN   — required; obtain via `flyctl auth token`
#   ENVIRONMENT     — production (default) | staging
#   DRY_RUN         — 1 = echo commands only, no side effects
#   FLY_REGION      — override deploy region (default: iad)

set -euo pipefail

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
readonly APP_NAME="analytics-clickhouse"
readonly FLY_TOML="infra/fly/analytics-clickhouse/fly.toml"
readonly MIGRATIONS_DIR="infra/clickhouse/migrations"
readonly ENVIRONMENT="${ENVIRONMENT:-production}"
readonly FLY_REGION="${FLY_REGION:-iad}"
readonly DRY_RUN="${DRY_RUN:-0}"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
log() {
  printf '[deploy-clickhouse] %s\n' "$*" >&2
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

  # Required env vars — never echo their values
  [[ -z "${FLY_API_TOKEN:-}" ]] && MISSING+=("FLY_API_TOKEN")

  if [[ ${#MISSING[@]} -gt 0 ]]; then
    log "Missing required secrets/env vars:"
    for VAR in "${MISSING[@]}"; do
      log "  - ${VAR}  (set in shell env or via flyctl secrets)"
    done
    die "Resolve missing secrets before deploying."
  fi
}

checkDeps() {
  command -v flyctl >/dev/null 2>&1 || die "'flyctl' not found. Install: https://fly.io/docs/hands-on/install-flyctl/"
}

ensureVolume() {
  log "Checking Fly volume 'clickhouse_data' in region ${FLY_REGION}..."
  if ! flyctl volumes list --app "${APP_NAME}" --json 2>/dev/null \
       | grep -q '"clickhouse_data"'; then
    log "Volume not found — creating (20 GB)..."
    run flyctl volumes create clickhouse_data \
      --app "${APP_NAME}" \
      --region "${FLY_REGION}" \
      --size 20 \
      --yes
  else
    log "Volume exists — skipping creation."
  fi
}

deploy() {
  log "Deploying ${APP_NAME} (environment=${ENVIRONMENT}, region=${FLY_REGION})..."
  run flyctl deploy \
    --config "${FLY_TOML}" \
    --app "${APP_NAME}" \
    --remote-only \
    --strategy rolling
}

printMigrationsNote() {
  log ""
  log "==================================================================="
  log "MIGRATIONS NOTE"
  log "==================================================================="
  log "Apply the initial schema to ClickHouse after first deploy:"
  log ""
  log "  # Stream SQL over the Fly proxy to the ClickHouse HTTP API:"
  log "  flyctl proxy 8123 --app ${APP_NAME} &"
  log "  PROXY_PID=\$!"
  log "  curl -u 'default:<CLICKHOUSE_ADMIN_PASSWORD>' \\"
  log "       http://localhost:8123/ \\"
  log "       --data-binary @${MIGRATIONS_DIR}/0001_init.sql"
  log "  kill \${PROXY_PID}"
  log ""
  log "Migration files: ${MIGRATIONS_DIR}/"
  log "==================================================================="
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
main() {
  log "Starting deploy — app=${APP_NAME}, env=${ENVIRONMENT}, dry_run=${DRY_RUN}"

  checkDeps
  checkSecrets
  ensureVolume
  deploy
  printMigrationsNote

  log "Done."
}

main "$@"
