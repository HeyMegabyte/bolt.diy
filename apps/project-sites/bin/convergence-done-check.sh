#!/usr/bin/env bash
# bin/convergence-done-check.sh — returns 0 when ALL ProjectSites.dev convergence
# DONE conditions met. Run at the START of every loop fire. Companion to
# CONVERGENCE_PROMPT.md.
#
# Three independent stops (whichever fires first):
# 1. DONE gate green — all checklist blocks clear → self-cancel
# 2. Hard pass ceiling — MAX_PASSES reached → stop unconditionally
# 3. No-progress streak — K consecutive passes with 0 changes → stop
#
# Usage: bash bin/convergence-done-check.sh
# Exit:  0 = DONE (write _CONVERGENCE_DONE + cancel loop)
#        1 = NOT-DONE (continue convergence)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

MAX_PASSES="${MAX_PASSES:-300}"
NO_PROGRESS_STREAK="${NO_PROGRESS_STREAK:-5}"
LOG_FILE="_CONVERGENCE_LOG.md"
SENTINEL="_CONVERGENCE_DONE"

# ── Sentinel already written ──────────────────────────────────────────
if [ -f "$SENTINEL" ]; then
  echo "DONE (sentinel: $(cat "$SENTINEL"))"
  exit 0
fi

# ── Count passes ──────────────────────────────────────────────────────
PASS_COUNT=$(grep -c '^## Pass' "$LOG_FILE" 2>/dev/null || echo 0)

# ── Hard ceiling ──────────────────────────────────────────────────────
if [ "$PASS_COUNT" -ge "$MAX_PASSES" ]; then
  echo "DONE (ceiling: $PASS_COUNT passes, max $MAX_PASSES)"
  exit 0
fi

# ── No-progress streak ────────────────────────────────────────────────
LAST_COMMITS=$(git log --oneline --since="2 hours ago" -- . 2>/dev/null | wc -l | tr -d '[:space:]')
LAST_COMMITS=${LAST_COMMITS:-0}
if [ "$LAST_COMMITS" -eq 0 ] 2>/dev/null; then
  NO_PROGRESS=$(tail -10 "$LOG_FILE" 2>/dev/null | grep -c '0 changes\|no changes' || echo "0")
  NO_PROGRESS=$(echo "$NO_PROGRESS" | tr -d '[:space:]')
  NO_PROGRESS=${NO_PROGRESS:-0}
  if [ "$NO_PROGRESS" -ge "$NO_PROGRESS_STREAK" ] 2>/dev/null; then
    echo "DONE (no-progress streak: $NO_PROGRESS passes)"
    exit 0
  fi
fi

# ── Fast green checks (non-exhaustive — the spec is CONVERGENCE_PROMPT.md § DONE) ─
GREEN_CHECKS=0
TOTAL_CHECKS=5

# Check 1: typecheck clean?
if (cd "$PROJECT_DIR" && npx tsc --noEmit 2>/dev/null); then
  GREEN_CHECKS=$((GREEN_CHECKS + 1))
fi

# Check 2: lint clean?
if (cd "$PROJECT_DIR" && npx eslint --config eslint.config.mjs src 2>/dev/null); then
  GREEN_CHECKS=$((GREEN_CHECKS + 1))
fi

# Check 3: unit tests green?
if (cd "$PROJECT_DIR" && npm test 2>/dev/null); then
  GREEN_CHECKS=$((GREEN_CHECKS + 1))
fi

# Check 4: gap matrix exists and shows no critical gaps?
if [ -f _CONVERGENCE_GAP_MATRIX.md ]; then
  CRITICAL=$(grep -c 'P0\|P1' _CONVERGENCE_GAP_MATRIX.md 2>/dev/null || echo 0)
  if [ "$CRITICAL" -eq 0 ]; then
    GREEN_CHECKS=$((GREEN_CHECKS + 1))
  fi
else
  # Matrix hasn't been created yet — not done
  :
fi

# Check 5: deploy smoke passing? (best-effort — network may not be available)
PROD_CODE=$(curl -s -o /dev/null -w '%{http_code}' https://projectsites.dev/ 2>/dev/null || echo '000')
if [ "$PROD_CODE" = "200" ]; then
  GREEN_CHECKS=$((GREEN_CHECKS + 1))
fi

echo "NOT-DONE (pass $PASS_COUNT · checks $GREEN_CHECKS/$TOTAL_CHECKS green)"
exit 1
