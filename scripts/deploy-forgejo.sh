#!/usr/bin/env bash
# deploy-forgejo.sh — Deploy the Forgejo Fly.io app (Git forge at git.projectsites.dev)
#
# Usage:
#   ./scripts/deploy-forgejo.sh
#   DRY_RUN=1 ./scripts/deploy-forgejo.sh
#
# Environment variables:
#   FLY_API_TOKEN    — required; obtain via `flyctl auth token`
#   DRY_RUN          — 1 = echo commands only, no side effects
#
# Required Fly secrets (set once via `flyctl secrets set KEY=value --app forgejo`):
#   FORGEJO__database__HOST         — Neon host
#   FORGEJO__database__NAME         — projectsites_forgejo
#   FORGEJO__database__USER         — neondb_owner
#   FORGEJO__database__PASSWD       — Neon password
#   FORGEJO__security__SECRET_KEY   — global secret key (openssl rand -hex 64)
#   FORGEJO__security__INTERNAL_TOKEN — internal token (openssl rand -hex 64)
#   FORGEJO__oauth2__JWT_SECRET     — OAuth2 JWT secret (openssl rand -hex 43)
#   FORGEJO__lfs__JWT_SECRET        — LFS JWT secret (openssl rand -hex 43)
#
# One-way door decisions:
#   - Fly.io for persistent Git storage (CF Containers ephemeral)
#   - Neon Postgres over embedded SQLite (production durability)
#   - R2 for LFS/attachments (S3-compatible, CF-native)
#   - ADR: docs/decisions/NNNN-forgejo-hosting.md (to be written)

set -euo pipefail

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
readonly APP_NAME="projectsites-forgejo"
readonly FLY_TOML="infra/fly/forgejo/fly.toml"
readonly DRY_RUN="${DRY_RUN:-0}"
readonly VOLUME_NAME="forgejo_data"
readonly VOLUME_SIZE_GB="${VOLUME_SIZE_GB:-20}"
readonly REGION="${REGION:-ewr}"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
log() {
  printf '[deploy-forgejo] %s\n' "$*" >&2
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

checkDeps() {
  command -v flyctl >/dev/null 2>&1 \
    || die "'flyctl' not found. Install: https://fly.io/docs/hands-on/install-flyctl/"
}

checkSecrets() {
  local MISSING=()

  if [[ -z "${FLY_API_TOKEN:-}" ]]; then
    if command -v get-secret >/dev/null 2>&1; then
      FLY_API_TOKEN="$(get-secret FLY_API_TOKEN 2>/dev/null || true)"
    fi
  fi

  [[ -z "${FLY_API_TOKEN:-}" ]] && MISSING+=("FLY_API_TOKEN")

  if [[ ${#MISSING[@]} -gt 0 ]]; then
    log "Missing required env vars (values not shown):"
    for VAR in "${MISSING[@]}"; do
      log "  - ${VAR}"
    done
    die "Resolve missing env vars before deploying."
  fi
}

checkAppExists() {
  flyctl apps list --json 2>/dev/null | grep -q "\"Name\":\"${APP_NAME}\"" || return 1
}

createApp() {
  if checkAppExists; then
    log "App '${APP_NAME}' already exists — skipping creation."
    return
  fi

  log "Creating Fly.io app: ${APP_NAME} (region=${REGION})..."
  run flyctl apps create "${APP_NAME}" --org personal
}

createVolume() {
  if flyctl volumes list --app "${APP_NAME}" --json 2>/dev/null | grep -q "\"name\":\"${VOLUME_NAME}\""; then
    log "Volume '${VOLUME_NAME}' already exists — skipping creation."
    return
  fi

  log "Creating persistent volume: ${VOLUME_NAME} (${VOLUME_SIZE_GB}GB, region=${REGION})..."
  run flyctl volumes create "${VOLUME_NAME}" \
    --size "${VOLUME_SIZE_GB}" \
    --region "${REGION}" \
    --app "${APP_NAME}"
}

provisionSecrets() {
  log "Checking required Fly secrets..."

  local PROVISIONED
  PROVISIONED=$(flyctl secrets list --app "${APP_NAME}" --json 2>/dev/null \
    | python3 -c "import sys,json; [print(s['Name']) for s in json.load(sys.stdin)]" 2>/dev/null || true)

  local REQUIRED_SECRETS=(
    "FORGEJO__database__HOST"
    "FORGEJO__database__NAME"
    "FORGEJO__database__USER"
    "FORGEJO__database__PASSWD"
    "FORGEJO__security__SECRET_KEY"
    "FORGEJO__security__INTERNAL_TOKEN"
    "FORGEJO__oauth2__JWT_SECRET"
    "FORGEJO__lfs__JWT_SECRET"
  )

  local MISSING=()
  for SECRET in "${REQUIRED_SECRETS[@]}"; do
    if ! echo "${PROVISIONED}" | grep -qFx "${SECRET}"; then
      MISSING+=("${SECRET}")
    fi
  done

  if [[ ${#MISSING[@]} -eq 0 ]]; then
    log "All required secrets already set."
    return
  fi

  log "Missing secrets detected (auto-generating where possible):"
  for SECRET in "${MISSING[@]}"; do
    log "  - ${SECRET}"
  done

  # Auto-generate self-creatable secrets
  if echo "${MISSING[@]}" | grep -q "FORGEJO__security__SECRET_KEY"; then
    local SECRET_KEY
    SECRET_KEY=$(openssl rand -hex 64)
    run flyctl secrets set "FORGEJO__security__SECRET_KEY=${SECRET_KEY}" --app "${APP_NAME}"
    log "  ✓ FORGEJO__security__SECRET_KEY auto-generated"
  fi

  if echo "${MISSING[@]}" | grep -q "FORGEJO__security__INTERNAL_TOKEN"; then
    local INTERNAL_TOKEN
    INTERNAL_TOKEN=$(openssl rand -hex 64)
    run flyctl secrets set "FORGEJO__security__INTERNAL_TOKEN=${INTERNAL_TOKEN}" --app "${APP_NAME}"
    log "  ✓ FORGEJO__security__INTERNAL_TOKEN auto-generated"
  fi

  if echo "${MISSING[@]}" | grep -q "FORGEJO__oauth2__JWT_SECRET"; then
    local OAUTH_JWT
    OAUTH_JWT=$(openssl rand -hex 43)
    run flyctl secrets set "FORGEJO__oauth2__JWT_SECRET=${OAUTH_JWT}" --app "${APP_NAME}"
    log "  ✓ FORGEJO__oauth2__JWT_SECRET auto-generated"
  fi

  if echo "${MISSING[@]}" | grep -q "FORGEJO__lfs__JWT_SECRET"; then
    local LFS_JWT
    LFS_JWT=$(openssl rand -hex 43)
    run flyctl secrets set "FORGEJO__lfs__JWT_SECRET=${LFS_JWT}" --app "${APP_NAME}"
    log "  ✓ FORGEJO__lfs__JWT_SECRET auto-generated"
  fi

  # Database secrets — need manual values from Neon
  local NEEDS_MANUAL=()
  if echo "${MISSING[@]}" | grep -q "FORGEJO__database__HOST"; then
    NEEDS_MANUAL+=("FORGEJO__database__HOST")
  fi
  if echo "${MISSING[@]}" | grep -q "FORGEJO__database__NAME"; then
    run flyctl secrets set "FORGEJO__database__NAME=projectsites_forgejo" --app "${APP_NAME}"
    log "  ✓ FORGEJO__database__NAME=projectsites_forgejo"
  fi
  if echo "${MISSING[@]}" | grep -q "FORGEJO__database__USER"; then
    run flyctl secrets set "FORGEJO__database__USER=neondb_owner" --app "${APP_NAME}"
    log "  ✓ FORGEJO__database__USER=neondb_owner"
  fi
  if echo "${MISSING[@]}" | grep -q "FORGEJO__database__PASSWD"; then
    NEEDS_MANUAL+=("FORGEJO__database__PASSWD")
  fi

  if [[ ${#NEEDS_MANUAL[@]} -gt 0 ]]; then
    log ""
    log "==================================================================="
    log "MANUAL SECRETS REQUIRED — set these before deploy:"
    log "==================================================================="
    for SECRET in "${NEEDS_MANUAL[@]}"; do
      log "  flyctl secrets set ${SECRET}=<value> --app ${APP_NAME}"
    done
    log ""
    log "Neon connection details:"
    log "  Host: ep-round-wildflower-aigybxdk-pooler.c-4.us-east-1.aws.neon.tech"
    log "  Database: projectsites_forgejo"
    log "  User: neondb_owner"
    log "  Password: from get-secret NEON_PASSWORD or Neon dashboard"
    log "==================================================================="
    die "Set the manual secrets above, then re-run."
  fi
}

deploy() {
  log "Deploying ${APP_NAME}..."
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
  log "Starting deploy — app=${APP_NAME}, region=${REGION}, dry_run=${DRY_RUN}"

  checkDeps
  checkSecrets
  createApp
  createVolume
  provisionSecrets
  deploy

  log ""
  log "==================================================================="
  log "POST-DEPLOY CHECKLIST"
  log "==================================================================="
  log "1. Set up Cloudflare DNS:"
  log "   git.projectsites.dev CNAME → forgejo.fly.dev (proxied)"
  log "   forgejo.projectsites.dev CNAME → forgejo.fly.dev (proxied)"
  log "2. Verify: node scripts/verify-forgejo.mjs"
  log "3. Create admin user via Fly console:"
  log "   flyctl ssh console --app ${APP_NAME} -C 'su - git -c \"/usr/local/bin/gitea admin user create --admin --username <user> --password <pass> --email <email>\"'"
  log "   Or visit https://git.projectsites.dev/ and register (first user = admin)"
  log "==================================================================="
  log "Done."
}

main "$@"
