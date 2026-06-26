#!/usr/bin/env bash
# verify-sentry-removed.sh — grep the entire repo for active Sentry references.
# Exit 1 if any found. Exit 0 if clean.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_ROOT

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
readonly SCRIPT_NAME

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
for _cmd in grep; do
    if ! command -v "${_cmd}" > /dev/null 2>&1; then
        printf 'ERROR: required command not found: %s\n' "${_cmd}" >&2
        exit 1
    fi
done

# ---------------------------------------------------------------------------
# Temp file – accumulates all matched lines
# ---------------------------------------------------------------------------
TMPFILE=''
cleanup() {
    [[ -z "${TMPFILE:-}" ]] || rm -f "${TMPFILE}"
}
trap cleanup EXIT

TMPFILE="$(mktemp)"
readonly TMPFILE

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# grep_ts_js PATTERN
#   Search *.ts / *.js / *.tsx / *.jsx for PATTERN (case-insensitive, fixed-string).
#   Appends matches to TMPFILE; never exits on no-match.
grep_ts_js() {
    local pattern="$1"
    grep -rn \
        --include='*.ts' \
        --include='*.js' \
        --include='*.tsx' \
        --include='*.jsx' \
        -iF "${pattern}" \
        --exclude-dir=docs \
        --exclude-dir=node_modules \
        --exclude-dir=dist \
        --exclude-dir=.git \
        --exclude-dir=.angular \
        --exclude-dir=.wrangler \
        --exclude='*.example' \
        --exclude="${SCRIPT_NAME}" \
        --exclude='sentry-removed.md' \
        "${REPO_ROOT}" >> "${TMPFILE}" 2>/dev/null || true
}

# grep_all PATTERN
#   Search all text files for PATTERN (case-insensitive, fixed-string).
#   Excludes docs/, node_modules/, dist/, .git/, *.example, this script, sentry-removed.md.
grep_all() {
    local pattern="$1"
    grep -rn \
        -iF "${pattern}" \
        --exclude-dir=docs \
        --exclude-dir=node_modules \
        --exclude-dir=dist \
        --exclude-dir=.git \
        --exclude-dir=.angular \
        --exclude-dir=.wrangler \
        --exclude='*.example' \
        --exclude='*.png' \
        --exclude='*.jpg' \
        --exclude='*.jpeg' \
        --exclude='*.gif' \
        --exclude='*.ico' \
        --exclude='*.woff' \
        --exclude='*.woff2' \
        --exclude="${SCRIPT_NAME}" \
        --exclude='sentry-removed.md' \
        "${REPO_ROOT}" >> "${TMPFILE}" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Main scan
# ---------------------------------------------------------------------------
printf '=== Sentry Reference Scan ===\n'
printf 'Repo root: %s\n\n' "${REPO_ROOT}"

# Patterns scoped to TS/JS source files
grep_ts_js '@sentry/'
grep_ts_js 'withSentry('
grep_ts_js 'sentry.init('
grep_ts_js 'Sentry.captureException('

# Patterns checked across all text files (docs/ and *.example already excluded)
grep_all 'SENTRY_DSN='
grep_all 'ingest.sentry.io'

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
TOTAL_VIOLATIONS=0

if [[ -s "${TMPFILE}" ]]; then
    while IFS= read -r _line; do
        printf '%s\n' "${_line}"
        TOTAL_VIOLATIONS=$((TOTAL_VIOLATIONS + 1))
    done < "${TMPFILE}"
    printf '\nSENTRY_VIOLATIONS: %d active reference(s) found\n' "${TOTAL_VIOLATIONS}"
    exit 1
else
    printf 'SENTRY_CLEAN: no active Sentry references found\n'
    exit 0
fi
