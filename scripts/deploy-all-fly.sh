#!/usr/bin/env bash
# deploy-all-fly.sh — Orchestrate all Fly.io app deployments in dependency order.
#
# Deployment order (respect data-plane dependencies):
#   1. analytics-ingest       — event ingest + ClickHouse bridge
#   2. telemetry-router       — OTel collector (independent of analytics)
#   3. support-chatwoot       — Chatwoot support hub (independent)
#   4. social-postiz          — Postiz social scheduler (independent)
#
# Usage:
#   ./scripts/deploy-all-fly.sh
#   DRY_RUN=1 ./scripts/deploy-all-fly.sh
#   DRY_RUN=true ./scripts/deploy-all-fly.sh      # legacy alias
#   SERVICES="telemetry-router social-postiz" ./scripts/deploy-all-fly.sh
#   ./scripts/deploy-all-fly.sh --help
#
# Environment variables:
#   FLY_API_TOKEN   — required; resolve via get-secret or flyctl auth token
#   DRY_RUN         — 1 or "true" = skip all deploy calls (passed to sub-scripts)
#   SERVICES        — space-separated list of service names to limit the run
#   ENVIRONMENT     — production (default) | staging (passed to sub-scripts)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

# --------------------------------------------------------------------------
# Usage
# --------------------------------------------------------------------------
usage() {
  printf 'Usage: %s [--help]\n' "$(basename "${BASH_SOURCE[0]}")"
  printf '\n'
  printf 'Deploy all Fly.io services for projectsites.dev in dependency order.\n'
  printf '\n'
  printf 'Environment variables:\n'
  printf '  FLY_API_TOKEN   Required. Fly.io API token.\n'
  printf '  DRY_RUN         Optional. 1 or "true" prints commands only. Default: 0.\n'
  printf '  SERVICES        Optional. Space-separated subset of services to deploy.\n'
  printf '  ENVIRONMENT     Optional. production (default) | staging.\n'
  printf '\n'
  printf 'Available services:\n'
  printf '  analytics-ingest   telemetry-router   support-chatwoot   social-postiz\n'
  printf '\n'
  printf 'Exit codes:\n'
  printf '  0  All services deployed successfully.\n'
  printf '  1  One or more services failed.\n'
}

if [[ "${1:-}" == '--help' ]]; then
  usage
  exit 0
fi

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
# Normalise DRY_RUN: accept both "1" and "true"
if [[ "${DRY_RUN:-0}" == "true" ]]; then
  DRY_RUN=1
fi
readonly DRY_RUN="${DRY_RUN:-0}"
readonly ENVIRONMENT="${ENVIRONMENT:-production}"

# Ordered service list — override with SERVICES env var for partial runs
ALL_SERVICES="analytics-ingest telemetry-router support-chatwoot social-postiz"
readonly REQUESTED_SERVICES="${SERVICES:-${ALL_SERVICES}}"

# Map service name → deploy script
declare -A DEPLOY_SCRIPT=(
  ["analytics-ingest"]="${SCRIPT_DIR}/deploy-analytics-ingest.sh"
  ["telemetry-router"]="${SCRIPT_DIR}/deploy-telemetry-router.sh"
  ["support-chatwoot"]="${SCRIPT_DIR}/deploy-chatwoot.sh"
  ["social-postiz"]="${SCRIPT_DIR}/deploy-postiz.sh"
)

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
log() {
  printf '[deploy-all-fly] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

# --------------------------------------------------------------------------
# FLY_API_TOKEN resolution
# --------------------------------------------------------------------------
if [[ -z "${FLY_API_TOKEN:-}" ]]; then
  if command -v get-secret >/dev/null 2>&1; then
    FLY_API_TOKEN="$(get-secret FLY_API_TOKEN 2>/dev/null || true)"
  fi
fi

if [[ -z "${FLY_API_TOKEN:-}" && "${DRY_RUN}" != "1" ]]; then
  die "FLY_API_TOKEN is not set. Run: export FLY_API_TOKEN=\$(flyctl auth token)"
fi
export FLY_API_TOKEN

# --------------------------------------------------------------------------
# Validate requested services
# --------------------------------------------------------------------------
ORDERED_SERVICES=()
for SERVICE in ${REQUESTED_SERVICES}; do
  if [[ -z "${DEPLOY_SCRIPT[${SERVICE}]:-}" ]]; then
    die "Unknown service: '${SERVICE}'. Valid services: ${!DEPLOY_SCRIPT[*]}"
  fi
  if [[ ! -f "${DEPLOY_SCRIPT[${SERVICE}]}" ]]; then
    die "Deploy script not found: ${DEPLOY_SCRIPT[${SERVICE}]}"
  fi
  ORDERED_SERVICES+=("${SERVICE}")
done

# --------------------------------------------------------------------------
# Deploy loop (serial — respect dependency order; collect all failures)
# --------------------------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0
FAILED_SERVICES=()

log "Starting deployment run"
log "  services:    ${ORDERED_SERVICES[*]}"
log "  environment: ${ENVIRONMENT}"
log "  dry_run:     ${DRY_RUN}"
log ""

for SERVICE in "${ORDERED_SERVICES[@]}"; do
  SCRIPT="${DEPLOY_SCRIPT[${SERVICE}]}"
  log "============================================================"
  log "Deploying: ${SERVICE}"
  log "Script:    ${SCRIPT}"
  log "============================================================"

  EXIT_CODE=0
  DRY_RUN="${DRY_RUN}" ENVIRONMENT="${ENVIRONMENT}" bash "${SCRIPT}" \
    || EXIT_CODE=$?

  if [[ "${EXIT_CODE}" -eq 0 ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    log "PASS: ${SERVICE}"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_SERVICES+=("${SERVICE}")
    log "FAIL: ${SERVICE} (exit=${EXIT_CODE})"
    # Continue to next service — accumulate failures rather than aborting early.
  fi
  log ""
done

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
log "============================================================"
log "DEPLOYMENT SUMMARY"
log "============================================================"
log "PASS: ${PASS_COUNT}"
log "FAIL: ${FAIL_COUNT}"

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
  log "Failed services: ${FAILED_SERVICES[*]}"
  log ""
  log "POST-DEPLOY CHECKLIST"
  log "  Run: ./scripts/verify-all-services.sh"
  log "  Fix failed deployments above, then re-run this script."
  exit 1
else
  log ""
  log "POST-DEPLOY CHECKLIST"
  log "  Run: ./scripts/verify-all-services.sh"
  log "  Verify: reports/deployment-verification.json → all pass"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "DRY_RUN: no services were actually deployed"
  else
    log "Done."
  fi
  exit 0
fi
