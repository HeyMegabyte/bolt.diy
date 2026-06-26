#!/usr/bin/env bash
# deploy-telemetry-router.sh — Deploy the telemetry-router Fly.io app
#
# Usage:
#   ./scripts/deploy-telemetry-router.sh
#   DRY_RUN=1 ./scripts/deploy-telemetry-router.sh
#   ENVIRONMENT=staging ./scripts/deploy-telemetry-router.sh
#
# Environment variables:
#   FLY_API_TOKEN   — required; obtain via `flyctl auth token`
#   ENVIRONMENT     — production (default) | staging
#   DRY_RUN         — 1 = echo commands only, no side effects
#
# Required Fly secrets (set once via `flyctl secrets set KEY=value --app telemetry-router`):
#   AXIOM_TOKEN              — Axiom API token
#   AXIOM_DATASET            — Axiom dataset name
#   POSTHOG_PROJECT_API_KEY  — PostHog project API key (future exporter)
#
# IMPORTANT: Before creating a DNS record for telemetry.projectsites.dev,
# confirm that Cloudflare Access or the collector auth extension is protecting
# the OTLP endpoints.  See docs/observability/otel.md

set -euo pipefail

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
readonly APP_NAME="telemetry-router"
readonly FLY_TOML="infra/fly/telemetry-router/fly.toml"
readonly ENVIRONMENT="${ENVIRONMENT:-production}"
readonly DRY_RUN="${DRY_RUN:-0}"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
log() {
  printf '[deploy-telemetry-router] %s\n' "$*" >&2
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
      "AXIOM_TOKEN"
      "AXIOM_DATASET"
      "POSTHOG_PROJECT_API_KEY"
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
  log "1. Verify health:    flyctl ssh console --app ${APP_NAME} -C 'wget -qO- http://localhost:13133/'"
  log "2. Confirm logs arriving in Axiom: https://app.axiom.co/datasets"
  log "3. IMPORTANT: Verify Cloudflare Access / auth extension protects"
  log "   OTLP ports before pointing telemetry.projectsites.dev at this app."
  log "4. Run: ./scripts/verify-observability-cleanup.sh"
  log "==================================================================="
  log "Done."
}

main "$@"
