#!/usr/bin/env bash
# loop-done-check.sh — terminal DONE gate for the projectsites.dev finishing loop.
# Prints "DONE" + exits 0 when the platform is complete; prints "NOT-DONE" + exits 1 otherwise.
# Per rules/loop-driven-development.md: a loop without a checkable DONE command is banned.
#
# Terminal condition (Brian, 2026-06-26):
#   1. Ledger empty   — no unchecked "[auto]" items remain in _LOOP_LEDGER.md
#   2. Flags green    — every IN-SCOPE flag enabled + prod-Playwright-proven
#                       (the features.ts experimental grab-bag stays DARK — out of scope)
#   3. Smoke green    — the consolidated prod Playwright smoke suite passes
# All three are tracked as "[x]" GATE checkboxes in _LOOP_PROGRESS.md; this script
# asserts those, then (when SMOKE=1) actually runs the prod smoke to confirm gate 3.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROGRESS="$APP_DIR/_LOOP_PROGRESS.md"
LEDGER="$APP_DIR/_LOOP_LEDGER.md"
SENTINEL="$APP_DIR/_LOOP_DONE"

logLine() { printf '%s\n' "$*" >&2; }

notDone() {
  logLine "NOT-DONE: $1"
  printf 'NOT-DONE\n'
  exit 1
}

# Gate 1 — ledger: zero unchecked [auto] items.
if [ -f "$LEDGER" ] && /usr/bin/grep -qE '^\s*-\s*\[ \].*\[auto\]' "$LEDGER"; then
  remaining="$(/usr/bin/grep -cE '^\s*-\s*\[ \].*\[auto\]' "$LEDGER" || true)"
  notDone "ledger has $remaining unchecked [auto] item(s)"
fi

# Gates 2 + 3 — tracked checkboxes in _LOOP_PROGRESS.md must read [x].
[ -f "$PROGRESS" ] || notDone "_LOOP_PROGRESS.md missing"
/usr/bin/grep -qE '^\s*-\s*\[x\]\s*GATE flags-green' "$PROGRESS" || notDone "GATE flags-green not checked"
/usr/bin/grep -qE '^\s*-\s*\[x\]\s*GATE smoke-green' "$PROGRESS" || notDone "GATE smoke-green not checked"

# Gate 3 (live) — actually run the prod smoke when SMOKE=1 (loop sets it on candidate-DONE passes).
if [ "${SMOKE:-0}" = "1" ]; then
  logLine "running prod smoke suite to confirm GATE smoke-green ..."
  ( cd "$APP_DIR/frontend" && npm run verify:production ) || notDone "prod smoke suite RED"
fi

# All gates green — write the sentinel and report DONE.
{
  printf 'DONE %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf 'unknown')"
  printf 'ledger empty + flags-green + smoke-green\n'
} > "$SENTINEL"

logLine "DONE: all gates green — sentinel written to $SENTINEL"
printf 'DONE\n'
exit 0
