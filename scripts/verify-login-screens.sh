#!/usr/bin/env bash
# verify-login-screens.sh — curl each service URL and print a results table.
# Exit 1 if any expected-up service returns non-2xx/3xx or fails to connect.
# Set DRY_RUN=true to print what would be checked without curling.
set -euo pipefail

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
for _cmd in curl awk; do
    if ! command -v "${_cmd}" > /dev/null 2>&1; then
        printf 'ERROR: required command not found: %s\n' "${_cmd}" >&2
        exit 1
    fi
done

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
readonly DRY_RUN="${DRY_RUN:-false}"

# Column widths for the results table
readonly COL_SVC=28
readonly COL_URL=48
readonly COL_STATUS=8
readonly COL_RESULT=8

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
FAIL_COUNT=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

print_separator() {
    printf '%s+%s+%s+%s\n' \
        "$(printf '%0.s-' $(seq 1 $((COL_SVC + 2))))" \
        "$(printf '%0.s-' $(seq 1 $((COL_URL + 2))))" \
        "$(printf '%0.s-' $(seq 1 $((COL_STATUS + 2))))" \
        "$(printf '%0.s-' $(seq 1 $((COL_RESULT + 2))))"
}

print_row() {
    local svc="$1"
    local url="$2"
    local status="$3"
    local result="$4"
    printf ' %-*s | %-*s | %-*s | %s\n' \
        "${COL_SVC}" "${svc}" \
        "${COL_URL}" "${url}" \
        "${COL_STATUS}" "${status}" \
        "${result}"
}

# get_status URL
#   Prints the HTTP status code (3 digits), or '000' on connection failure.
get_status() {
    local url="$1"
    local code
    code="$(curl --max-time 10 --silent \
        --write-out '%{http_code}' \
        --output /dev/null \
        "${url}" 2>/dev/null)" || true
    # Ensure we always have at least '000' when curl sets nothing
    printf '%s' "${code:-000}"
}

# is_ok STATUS_CODE
#   Returns 0 (true) if code starts with 2 or 3, 1 (false) otherwise.
is_ok() {
    local code="$1"
    [[ "${code}" =~ ^[23] ]]
}

# check_service LABEL URL
#   Curls URL, prints a table row, increments FAIL_COUNT on failure.
check_service() {
    local label="$1"
    local url="$2"
    local status
    local result

    if [[ "${DRY_RUN}" == 'true' ]]; then
        print_row "${label}" "${url}" 'SKIP' 'DRY_RUN'
        return
    fi

    status="$(get_status "${url}")"

    if is_ok "${status}"; then
        result='PASS'
    else
        result='FAIL'
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi

    print_row "${label}" "${url}" "${status}" "${result}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if [[ "${DRY_RUN}" == 'true' ]]; then
    printf '=== Service Health Check (DRY RUN) ===\n\n'
else
    printf '=== Service Health Check ===\n\n'
fi

print_row 'Service' 'URL' 'Status' 'Result'
print_separator

check_service 'support.projectsites.dev'    'https://support.projectsites.dev/'
check_service 'social.projectsites.dev'     'https://social.projectsites.dev/'
check_service 'logs.projectsites.dev'       'https://logs.projectsites.dev/'
check_service 'projectsites.dev/health'     'https://projectsites.dev/health'

print_separator

printf '\n'

if [[ "${DRY_RUN}" == 'true' ]]; then
    printf 'DRY_RUN: no requests made\n'
    exit 0
fi

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    printf 'SERVICE_HEALTH_FAIL: %d service(s) did not return 2xx/3xx\n' "${FAIL_COUNT}"
    exit 1
else
    printf 'SERVICE_HEALTH_PASS: all services returned 2xx/3xx\n'
    exit 0
fi
