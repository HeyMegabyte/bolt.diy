#!/usr/bin/env bash
# deploy-postiz.sh — Deploy the social-postiz Fly.io app (Postiz social scheduler)
#
# Usage:
#   ./scripts/deploy-postiz.sh
#   DRY_RUN=1 ./scripts/deploy-postiz.sh
#   SKIP_DB_MIGRATE=1 ./scripts/deploy-postiz.sh      # skip first-boot DB migration
#   ENVIRONMENT=staging ./scripts/deploy-postiz.sh
#
# Environment variables:
#   FLY_API_TOKEN    — required; obtain via `flyctl auth token`
#   ENVIRONMENT      — production (default) | staging
#   DRY_RUN          — 1 = echo commands only, no side effects
#   SKIP_DB_MIGRATE  — 1 = skip first-boot Prisma migration (subsequent deploys)
#
# Required Fly secrets (set once via `flyctl secrets set KEY=value --app social-postiz`):
#   DATABASE_URL            — Neon connection string (projectsites_postiz)
#   REDIS_URL               — Upstash Redis URL (rediss://...)
#   POSTIZ_JWT_SECRET       — JWT signing secret (openssl rand -hex 64)
#   STORAGE_BUCKET          — R2 bucket name for media
#   POSTIZ_ENCRYPTION_KEY   — AES-256 key (openssl rand -hex 32)
#   CLOUDFLARE_ACCOUNT_ID   — R2 account ID
#   CLOUDFLARE_ACCESS_KEY   — R2 access key ID
#   CLOUDFLARE_SECRET_KEY   — R2 secret access key
#
# AGPL NOTE: Postiz is an isolated reference service.
# ProjectSites-native Social does NOT depend on Postiz runtime.
# Do not copy AGPL Postiz code into proprietary modules.

set -euo pipefail

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
readonly APP_NAME="social-postiz"
readonly FLY_TOML="infra/fly/social-postiz/fly.toml"
readonly ENVIRONMENT="${ENVIRONMENT:-production}"
readonly DRY_RUN="${DRY_RUN:-0}"
readonly SKIP_DB_MIGRATE="${SKIP_DB_MIGRATE:-0}"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
log() {
  printf '[deploy-postiz] %s\n' "$*" >&2
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

  if [[ -z "${FLY_API_TOKEN:-}" ]]; then
    if command -v get-secret >/dev/null 2>&1; then
      FLY_API_TOKEN="$(get-secret FLY_API_TOKEN 2>/dev/null || true)"
    fi
  fi

  [[ -z "${FLY_API_TOKEN:-}" ]] && MISSING+=("FLY_API_TOKEN")

  if [[ "${DRY_RUN}" != "1" ]] && command -v flyctl >/dev/null 2>&1 \
     && [[ -z "${MISSING[*]:-}" ]]; then
    local REQUIRED_FLY_SECRETS=(
      "DATABASE_URL"
      "REDIS_URL"
      "POSTIZ_JWT_SECRET"
      "STORAGE_BUCKET"
      "POSTIZ_ENCRYPTION_KEY"
      "CLOUDFLARE_ACCOUNT_ID"
      "CLOUDFLARE_ACCESS_KEY"
      "CLOUDFLARE_SECRET_KEY"
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

runDbMigrate() {
  if [[ "${SKIP_DB_MIGRATE}" == "1" ]]; then
    log "SKIP_DB_MIGRATE=1 — skipping Prisma migration (subsequent deploy)."
    return
  fi

  log ""
  log "==================================================================="
  log "FIRST-BOOT: Running Prisma migrate deploy via Fly SSH console..."
  log "  Applies schema to projectsites_postiz (Neon)."
  log "  Set SKIP_DB_MIGRATE=1 on subsequent deploys."
  log "==================================================================="
  run flyctl ssh console \
    --app "${APP_NAME}" \
    --command "npx prisma migrate deploy"
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
main() {
  log "Starting deploy — app=${APP_NAME}, env=${ENVIRONMENT}, dry_run=${DRY_RUN}"

  checkDeps
  checkSecrets
  deploy
  runDbMigrate

  log ""
  log "==================================================================="
  log "POST-DEPLOY CHECKLIST"
  log "==================================================================="
  log "1. Verify: https://social.projectsites.dev  (Postiz login page)"
  log "2. Run:    ./scripts/verify-login-screens.sh"
  log "3. Create admin via Fly console if first install:"
  log "   flyctl ssh console --app ${APP_NAME}"
  log "   (see Postiz docs for first-admin bootstrap)"
  log "==================================================================="
  log "Done."
}

main "$@"
