#!/usr/bin/env bash
# verify-sentry-removed.sh — Confirm Sentry is fully removed from ProjectSites.
#
# ALLOW list (never flagged — these are intentional customer-facing features):
#   forwardSentry       — customer Sentry connector in event_dispatcher
#   analytics_providers — config key referencing sentry as a 3rd-party option
#   event_dispatcher    — the feature that relays events to customer Sentry orgs
#
# Excluded directories:
#   node_modules  dist  .angular  .wrangler  .git
#   storybook-static  coverage  .claude  .worktrees
#
# Excluded files:
#   package-lock.json  pnpm-lock.yaml  yarn.lock
#   docs/observability/sentry-removed.md  (the removal narrative)
#   scripts/verify-sentry-removed.sh       (this file)
#
# Exit codes:
#   0  clean — no active Sentry references found
#   1  violations found — listed to stdout

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_ROOT

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
readonly SCRIPT_NAME

# --------------------------------------------------------------------------
# Dependency check
# --------------------------------------------------------------------------
if ! command -v grep >/dev/null 2>&1; then
  printf 'ERROR: grep not found\n' >&2
  exit 1
fi

# Use system grep, not ugrep (which has false-zero bug on macOS)
GREP=/usr/bin/grep
if [[ ! -x "${GREP}" ]]; then
  GREP="$(command -v grep)"
fi
readonly GREP

# --------------------------------------------------------------------------
# Temp file — accumulates violations before the allow-list filter
# --------------------------------------------------------------------------
TMPRAW=''
TMPFILE=''
cleanup() {
  rm -f "${TMPRAW:-}" "${TMPFILE:-}"
}
trap cleanup EXIT

TMPRAW="$(mktemp)"
TMPFILE="$(mktemp)"
readonly TMPRAW TMPFILE

# --------------------------------------------------------------------------
# Shared exclusion flags
# --------------------------------------------------------------------------
EXCLUDE_DIRS=(
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=.git
  --exclude-dir=.angular
  --exclude-dir=.wrangler
  --exclude-dir=storybook-static
  --exclude-dir=coverage
  --exclude-dir=.claude
  --exclude-dir=.worktrees
)

EXCLUDE_FILES=(
  --exclude='package-lock.json'
  --exclude='pnpm-lock.yaml'
  --exclude='yarn.lock'
  --exclude='sentry-removed.md'
  --exclude='verify-*.sh'
  --exclude='CHANGES.md'
  --exclude='CHANGELOG.md'
  --exclude='changelog.md'
  --exclude="${SCRIPT_NAME}"
)

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

# grep_ts_js PATTERN
#   Search *.ts / *.js / *.tsx / *.jsx for PATTERN (fixed-string, case-insensitive).
#   Results appended to TMPRAW.
grep_ts_js() {
  local pattern="$1"
  "${GREP}" -rn \
    --include='*.ts' \
    --include='*.js' \
    --include='*.tsx' \
    --include='*.jsx' \
    "${EXCLUDE_DIRS[@]}" \
    "${EXCLUDE_FILES[@]}" \
    -iF "${pattern}" \
    "${REPO_ROOT}" >> "${TMPRAW}" 2>/dev/null || true
}

# grep_all PATTERN
#   Search all text files for PATTERN (fixed-string, case-insensitive).
#   Results appended to TMPRAW.
grep_all() {
  local pattern="$1"
  "${GREP}" -rn \
    "${EXCLUDE_DIRS[@]}" \
    "${EXCLUDE_FILES[@]}" \
    --exclude='*.png' --exclude='*.jpg' --exclude='*.jpeg' \
    --exclude='*.gif' --exclude='*.ico' --exclude='*.woff' \
    --exclude='*.woff2' --exclude='*.ttf' --exclude='*.eot' \
    --exclude='*.map' --exclude='*.svg' \
    -iF "${pattern}" \
    "${REPO_ROOT}" >> "${TMPRAW}" 2>/dev/null || true
}

# --------------------------------------------------------------------------
# Package.json dependency check (separate check — not filtered by allow list)
# --------------------------------------------------------------------------
PKG_SENTRY_VIOLATIONS=0

while IFS= read -r _pkg; do
  if "${GREP}" -qF '"@sentry/' "${_pkg}" 2>/dev/null; then
    printf 'package.json violation: %s contains @sentry/ dependency\n' "${_pkg}"
    PKG_SENTRY_VIOLATIONS=$((PKG_SENTRY_VIOLATIONS + 1))
  fi
done < <(find "${REPO_ROOT}" -name 'package.json' \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/.angular/*' \
  -not -path '*/.wrangler/*' \
  -not -path '*/storybook-static/*' \
  -not -path '*/coverage/*' \
  -not -path '*/.claude/*' 2>/dev/null)

# --------------------------------------------------------------------------
# Main scan — TS/JS source patterns
# --------------------------------------------------------------------------
printf '=== Sentry Reference Scan ===\n'
printf 'Repo root: %s\n\n' "${REPO_ROOT}"

# Core import/init patterns
grep_ts_js '@sentry/'
grep_ts_js 'withSentry('
grep_ts_js 'sentry.init('
grep_ts_js 'Sentry.init('
grep_ts_js 'Sentry.captureException('
grep_ts_js 'Sentry.captureMessage('
grep_ts_js 'Sentry.setTag('
grep_ts_js 'initSentryEarly'
grep_ts_js 'SentryService'

# Config / secrets patterns (all files)
grep_all 'SENTRY_DSN='
grep_all 'SENTRY_AUTH_TOKEN'
grep_all 'ingest.sentry.io'

# --------------------------------------------------------------------------
# Allow-list filter — strip lines matching intentional customer-facing code
#
# Allowed patterns (regex, case-insensitive):
#   forwardSentry     — customer connector feature
#   analytics_providers — config key
#   event_dispatcher  — the relay feature
#   docs/observability/sentry-removed — the removal narrative
# --------------------------------------------------------------------------
if [[ -s "${TMPRAW}" ]]; then
  "${GREP}" -viE '(forwardSentry|analytics_providers|event_dispatcher|sentry-removed)' \
    "${TMPRAW}" > "${TMPFILE}" 2>/dev/null || true
else
  touch "${TMPFILE}"
fi

# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------
TOTAL_VIOLATIONS=0

if [[ -s "${TMPFILE}" ]]; then
  while IFS= read -r _line; do
    printf '%s\n' "${_line}"
    TOTAL_VIOLATIONS=$((TOTAL_VIOLATIONS + 1))
  done < "${TMPFILE}"
fi

TOTAL_VIOLATIONS=$((TOTAL_VIOLATIONS + PKG_SENTRY_VIOLATIONS))

printf '\n'
if [[ "${TOTAL_VIOLATIONS}" -gt 0 ]]; then
  printf 'SENTRY_VIOLATIONS: %d active reference(s) found\n' "${TOTAL_VIOLATIONS}"
  exit 1
else
  printf 'SENTRY_CLEAN: no active Sentry references found\n'
  exit 0
fi
