#!/usr/bin/env bash
# verify-observability-cleanup.sh — assert observability docs and .env.example groups exist.
# Prints PASS/FAIL for each check. Exit 1 if any FAIL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_ROOT

readonly PS_ENV_EXAMPLE="${REPO_ROOT}/apps/project-sites/.env.example"
readonly ROOT_ENV_EXAMPLE="${REPO_ROOT}/.env.example"

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
# State
# ---------------------------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# check_file_exists PATH LABEL
#   Pass if file exists, fail otherwise.
check_file_exists() {
    local path="$1"
    local label="$2"
    if [[ -f "${path}" ]]; then
        printf 'PASS: %s\n' "${label}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        printf 'FAIL: %s (not found: %s)\n' "${label}" "${path}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

# check_contains FILE PATTERN LABEL
#   Pass if FILE contains a line matching PATTERN (fixed string).
check_contains() {
    local file="$1"
    local pattern="$2"
    local label="$3"
    if [[ ! -f "${file}" ]]; then
        printf 'FAIL: %s (file missing: %s)\n' "${label}" "${file}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        return
    fi
    if grep -qF "${pattern}" "${file}" 2>/dev/null; then
        printf 'PASS: %s\n' "${label}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        printf 'FAIL: %s (pattern "%s" not found in %s)\n' "${label}" "${pattern}" "${file}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

# check_not_contains FILE PATTERN LABEL
#   Pass if FILE does NOT contain a line matching PATTERN (fixed string).
check_not_contains() {
    local file="$1"
    local pattern="$2"
    local label="$3"
    if [[ ! -f "${file}" ]]; then
        # File missing counts as "pattern not present" — pass for a not-contains check.
        printf 'PASS: %s (file absent, so pattern absent)\n' "${label}"
        PASS_COUNT=$((PASS_COUNT + 1))
        return
    fi
    if grep -qF "${pattern}" "${file}" 2>/dev/null; then
        printf 'FAIL: %s (pattern "%s" must NOT appear in %s)\n' "${label}" "${pattern}" "${file}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    else
        printf 'PASS: %s\n' "${label}"
        PASS_COUNT=$((PASS_COUNT + 1))
    fi
}

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------
printf '=== Observability Cleanup Verification ===\n'
printf 'Repo root: %s\n\n' "${REPO_ROOT}"

# 1–7: required documentation files
check_file_exists "${REPO_ROOT}/docs/observability/README.md"      'docs/observability/README.md exists'
check_file_exists "${REPO_ROOT}/docs/observability/sentry-removed.md" 'docs/observability/sentry-removed.md exists'
check_file_exists "${REPO_ROOT}/docs/observability/posthog.md"     'docs/observability/posthog.md exists'
check_file_exists "${REPO_ROOT}/docs/observability/axiom.md"       'docs/observability/axiom.md exists'
check_file_exists "${REPO_ROOT}/docs/observability/otel.md"        'docs/observability/otel.md exists'
check_file_exists "${REPO_ROOT}/docs/analytics/clickhouse.md"      'docs/analytics/clickhouse.md exists'
check_file_exists "${REPO_ROOT}/docs/analytics/ingestion.md"       'docs/analytics/ingestion.md exists'

# 8–11: apps/project-sites/.env.example must contain provider group headers
# Sections use em-dash format: "# ── PostHog ──" — match on the name alone (mixed-case unique)
check_contains "${PS_ENV_EXAMPLE}"   'PostHog'           'apps/project-sites/.env.example contains PostHog section'
check_contains "${PS_ENV_EXAMPLE}"   'Axiom'             'apps/project-sites/.env.example contains Axiom section'
check_contains "${PS_ENV_EXAMPLE}"   'OpenTelemetry'     'apps/project-sites/.env.example contains OpenTelemetry section'
check_contains "${PS_ENV_EXAMPLE}"   'ClickHouse'        'apps/project-sites/.env.example contains ClickHouse section'

# 12: apps/project-sites/.env.example must NOT contain SENTRY_DSN=
check_not_contains "${PS_ENV_EXAMPLE}" 'SENTRY_DSN=' 'apps/project-sites/.env.example does not contain SENTRY_DSN='

# 13: root .env.example must contain # PostHog
check_contains "${ROOT_ENV_EXAMPLE}" '# PostHog' '.env.example (root) contains # PostHog'

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n--- Summary ---\n'
printf 'PASS: %d\n' "${PASS_COUNT}"
printf 'FAIL: %d\n' "${FAIL_COUNT}"

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    printf '\nOBSERVABILITY_CLEANUP_FAIL: %d check(s) failed\n' "${FAIL_COUNT}"
    exit 1
else
    printf '\nOBSERVABILITY_CLEANUP_PASS: all checks passed\n'
    exit 0
fi
