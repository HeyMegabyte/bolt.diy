#!/usr/bin/env bash
# verify-all-services.sh — orchestrate all verify-* scripts, write reports.
# Writes reports/deployment-verification.json and reports/deployment-verification.md.
# Exit 1 if any sub-script failed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_ROOT

readonly REPORTS_DIR="${REPO_ROOT}/reports"
readonly JSON_REPORT="${REPORTS_DIR}/deployment-verification.json"
readonly MD_REPORT="${REPORTS_DIR}/deployment-verification.md"

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
for _cmd in git date python3; do
    if ! command -v "${_cmd}" > /dev/null 2>&1; then
        printf 'ERROR: required command not found: %s\n' "${_cmd}" >&2
        exit 1
    fi
done

# Verify sub-scripts exist
for _script in verify-sentry-removed.sh verify-observability-cleanup.sh verify-login-screens.sh; do
    if [[ ! -x "${SCRIPT_DIR}/${_script}" ]]; then
        printf 'ERROR: script not executable or missing: %s/%s\n' "${SCRIPT_DIR}" "${_script}" >&2
        exit 1
    fi
done

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
mkdir -p "${REPORTS_DIR}"

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
readonly TIMESTAMP

GIT_SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
readonly GIT_SHA

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# json_escape STRING
#   Print STRING with characters escaped for embedding in a JSON string value.
#   (Surrounding quotes are not included.)
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"          # backslash → \\
    s="${s//\"/\\\"}"          # double-quote → \"
    s="${s//$'\n'/\\n}"        # newline → \n
    s="${s//$'\r'/\\r}"        # carriage return → \r
    s="${s//$'\t'/\\t}"        # tab → \t
    printf '%s' "${s}"
}

# md_escape STRING
#   Print STRING with pipe characters escaped for use in a Markdown table cell.
md_escape() {
    local s="$1"
    s="${s//|/\\|}"
    s="${s//$'\n'/ }"
    printf '%s' "${s}"
}

# run_check SCRIPT_BASENAME
#   Run the named script, capture stdout+stderr and exit code.
#   Sets: _check_output, _check_exit, _check_status (pass|fail)
_check_output=''
_check_exit=0
_check_status=''
run_check() {
    local script_basename="$1"
    local script_path="${SCRIPT_DIR}/${script_basename}"

    printf '--- Running %s ---\n' "${script_basename}"

    _check_exit=0
    _check_output="$(bash "${script_path}" 2>&1)" || _check_exit=$?

    if [[ "${_check_exit}" -eq 0 ]]; then
        _check_status='pass'
        printf 'Result: PASS\n\n'
    else
        _check_status='fail'
        printf 'Result: FAIL (exit %d)\n\n' "${_check_exit}"
    fi
}

# ---------------------------------------------------------------------------
# Run checks (all three — collect results before deciding final exit code)
# ---------------------------------------------------------------------------
printf '=== Deployment Verification ===\n'
printf 'Timestamp: %s\n' "${TIMESTAMP}"
printf 'Git SHA:   %s\n\n' "${GIT_SHA}"

run_check 'verify-sentry-removed.sh'
sentry_output="${_check_output}"
sentry_status="${_check_status}"
sentry_exit="${_check_exit}"

run_check 'verify-observability-cleanup.sh'
obs_output="${_check_output}"
obs_status="${_check_status}"
obs_exit="${_check_exit}"

run_check 'verify-login-screens.sh'
login_output="${_check_output}"
login_status="${_check_status}"
login_exit="${_check_exit}"

# ---------------------------------------------------------------------------
# Compute summary
# ---------------------------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0

for _s in "${sentry_status}" "${obs_status}" "${login_status}"; do
    if [[ "${_s}" == 'pass' ]]; then
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
done

OVERALL_EXIT=0
if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    OVERALL_EXIT=1
fi

# ---------------------------------------------------------------------------
# Write JSON report (via Python for correct string escaping)
# ---------------------------------------------------------------------------
python3 -c "
import json, os

checks = [
    {
        'name': os.environ['N1'],
        'status': os.environ['S1'],
        'output': os.environ['O1'],
    },
    {
        'name': os.environ['N2'],
        'status': os.environ['S2'],
        'output': os.environ['O2'],
    },
    {
        'name': os.environ['N3'],
        'status': os.environ['S3'],
        'output': os.environ['O3'],
    },
]

data = {
    'generated_at': os.environ['GEN_AT'],
    'git_sha': os.environ['GIT_SHA'],
    'checks': checks,
    'summary': {
        'pass': int(os.environ['PASS_COUNT']),
        'fail': int(os.environ['FAIL_COUNT']),
        'exit': int(os.environ['OVERALL_EXIT']),
    },
}

print(json.dumps(data, indent=2))
" \
    GEN_AT="${TIMESTAMP}" \
    GIT_SHA="${GIT_SHA}" \
    PASS_COUNT="${PASS_COUNT}" \
    FAIL_COUNT="${FAIL_COUNT}" \
    OVERALL_EXIT="${OVERALL_EXIT}" \
    N1='sentry-removed' S1="${sentry_status}" O1="${sentry_output}" \
    N2='observability-cleanup' S2="${obs_status}" O2="${obs_output}" \
    N3='login-screens' S3="${login_status}" O3="${login_output}" \
    > "${JSON_REPORT}"

printf 'JSON report written: %s\n' "${JSON_REPORT}"

# ---------------------------------------------------------------------------
# Write Markdown report
# ---------------------------------------------------------------------------
{
    printf '# Deployment Verification\n\n'
    printf '**Generated:** %s  \n' "${TIMESTAMP}"
    printf '**Git SHA:** `%s`  \n\n' "${GIT_SHA}"
    printf '| Check | Status | Notes |\n'
    printf '|---|---|---|\n'

    _sentry_notes="$(md_escape "exit ${sentry_exit}")"
    _obs_notes="$(md_escape "exit ${obs_exit}")"
    _login_notes="$(md_escape "exit ${login_exit}")"

    printf '| sentry-removed | %s | %s |\n' "${sentry_status}" "${_sentry_notes}"
    printf '| observability-cleanup | %s | %s |\n' "${obs_status}" "${_obs_notes}"
    printf '| login-screens | %s | %s |\n' "${login_status}" "${_login_notes}"

    printf '\n## Summary\n\n'
    printf '- **Pass:** %d\n' "${PASS_COUNT}"
    printf '- **Fail:** %d\n' "${FAIL_COUNT}"
    printf '- **Exit code:** %d\n' "${OVERALL_EXIT}"
} > "${MD_REPORT}"

printf 'MD report written:   %s\n\n' "${MD_REPORT}"

# ---------------------------------------------------------------------------
# Final result
# ---------------------------------------------------------------------------
printf '--- Summary ---\n'
printf 'PASS: %d  FAIL: %d\n' "${PASS_COUNT}" "${FAIL_COUNT}"

if [[ "${OVERALL_EXIT}" -ne 0 ]]; then
    printf '\nDEPLOY_VERIFY_FAIL: %d check(s) failed\n' "${FAIL_COUNT}"
    exit 1
else
    printf '\nDEPLOY_VERIFY_PASS: all checks passed\n'
    exit 0
fi
