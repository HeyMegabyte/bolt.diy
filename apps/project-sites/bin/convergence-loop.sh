#!/usr/bin/env bash
# Convergence Loop — Autonomous Feature Testing & Improvement
# Runs every 30m via CronCreate. Spawns 4-5 parallel agents to test,
# fix, and improve different admin sections using Browserbase + Stagehand.
#
# Usage: bash bin/convergence-loop.sh [--phase <name>] [--dry-run]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$PROJECT_DIR/_CONVERGENCE_LOOP.log"

log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }

# ── DONE gate: derived from the admin section CONTRACT, not hand-ticked markdown ──
# The old gate counted unchecked '[ ]' boxes in FEATURES_TO_TEST.md — a number
# decoupled from whether a section actually WORKS (730 boxes → never DONE, and a
# ticked box never proved a prod render). The real gate has two halves:
#   1. drift clean  — every live /admin route has an admin-contract row (0 slip-through)
#   2. sweep done   — every HARD section passed on PROD in the latest sweep report
# See docs/admin-convergence-tdd.md. Run scripts/validate-admin-contract.mjs +
# e2e/admin-verify/contract-sweep.mjs each fire to refresh both halves.
check_done() {
  local drift sweep_done report="$PROJECT_DIR/_ADMIN_CONTRACT_REPORT.json"
  if node "$PROJECT_DIR/scripts/validate-admin-contract.mjs" >/dev/null 2>&1; then drift=clean; else drift=DRIFT; fi
  if /usr/bin/grep -q '"done": true' "$report" 2>/dev/null; then sweep_done=true; else sweep_done=false; fi
  # Log to stderr — this fn's STDOUT is captured by `$(check_done)`, so it must emit
  # ONLY the DONE/NOT_DONE token (the old gate leaked its log line into the token).
  log "admin-contract gate: drift=$drift · sweep_done=$sweep_done" >&2

  if [ "$drift" = "clean" ] && [ "$sweep_done" = "true" ]; then
    echo "DONE"
  else
    echo "NOT_DONE"
  fi
}

# ── Phase selection ──────────────────────────────────────────────────────
select_phase() {
  local phase="${1:-}"
  if [ -n "$phase" ]; then echo "$phase"; return; fi

  # Pick the phase with the most untested features
  local auth admin_shell admin_primary admin_secondary marketing api cross
  auth=$(grep -c '^\- \[ \]' "$PROJECT_DIR/FEATURES_TO_TEST.md" 2>/dev/null | head -1)

  # Rotate through phases each run
  local idx
  idx=$(date +%H | awk '{ print ($1 % 6) + 1 }')
  case "$idx" in
    1) echo "admin-primary" ;;
    2) echo "admin-secondary" ;;
    3) echo "auth" ;;
    4) echo "cross-cutting" ;;
    5) echo "apps-catalog" ;;
    6) echo "marketing-api" ;;
  esac
}

# ── Main ─────────────────────────────────────────────────────────────────
main() {
  local phase dry_run
  dry_run=false
  phase=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --phase) phase="$2"; shift 2 ;;
      --dry-run) dry_run=true; shift ;;
      *) shift ;;
    esac
  done

  phase=$(select_phase "$phase")
  log "=== Convergence Loop — Phase: $phase ==="

  # DONE gate
  local done_status
  done_status=$(check_done)
  if [ "$done_status" = "DONE" ]; then
    log "✅ ALL FEATURES TESTED — convergence complete."
    touch "$PROJECT_DIR/_CONVERGENCE_DONE"
    exit 0
  fi

  # Progress summary
  local total tested
  total=$(grep -c '^\- \[' "$PROJECT_DIR/FEATURES_TO_TEST.md" 2>/dev/null || echo "100")
  tested=$(grep -c '^\- \[x\]' "$PROJECT_DIR/FEATURES_TO_TEST.md" 2>/dev/null || echo "0")
  log "Progress: $tested/$total features tested"

  if $dry_run; then
    log "DRY RUN — would spawn agents for: $phase"
    exit 0
  fi

  # ── Phase-specific parallel agent spawn ────────────────────────────────
  log "Spawning agents for phase: $phase..."

  case "$phase" in
    admin-primary)
      log "→ Agent 1: Dashboard + Editor visual inspection (Browserbase)"
      log "→ Agent 2: Snapshots + Analytics E2E specs"
      log "→ Agent 3: Forms + Apps catalog CF compatibility"
      log "→ Agent 4: Site Features + Social section tests"
      log "→ Agent 5: Logs + Feature Flags authenticated journeys"
      ;;
    admin-secondary)
      log "→ Agent 1: Domains + Billing E2E specs"
      log "→ Agent 2: User Settings + Team + Auth Security tests"
      log "→ Agent 3: Site Detail + Branches + Copilot + DNA tests"
      log "→ Agent 4: System Services + Docs + Settings (MCP fix)"
      ;;
    auth)
      log "→ Agent 1: Magic link flow E2E"
      log "→ Agent 2: Google/GitHub OAuth redirect verification"
      log "→ Agent 3: Sign-up flow + session management"
      log "→ Agent 4: Auth error states + rate limiting UX"
      ;;
    cross-cutting)
      log "→ Agent 1: Cmd+K + shortcuts overlay + theme toggle"
      log "→ Agent 2: PWA + CSP + security headers"
      log "→ Agent 3: Console error sweep all admin pages"
      log "→ Agent 4: Axe-core a11y sweep at 6 breakpoints"
      log "→ Agent 5: Mobile responsive 375px all sections"
      ;;
    apps-catalog)
      log "→ Agent 1: Filter apps for CF Container compatibility"
      log "→ Agent 2: Deploy wizard flow E2E (compatible apps)"
      log "→ Agent 3: Instance management (list, log, restart, delete)"
      log "→ Agent 4: App detail page rendering + env var forms"
      ;;
    marketing-api)
      log "→ Agent 1: Homepage + pricing + blog visual inspection"
      log "→ Agent 2: SEO metadata sweep all routes"
      log "→ Agent 3: API endpoint health checks"
      log "→ Agent 4: Platform services reachability"
      ;;
  esac

  log "=== Convergence phase dispatched ==="
  log "Next: agents complete → main thread folds → deploy → verify → mark done"
}

main "$@"
