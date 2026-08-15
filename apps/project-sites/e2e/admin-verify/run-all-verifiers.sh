#!/usr/bin/env bash
#
# run-all-verifiers.sh — ONE regression command for the whole no-build convergence
# arc (iters 70-79). Chains every prod verifier: the 4 causal ingest/mutation
# reconcilers + the pre-existing forms causal test + the 11-surface read reconciler.
#
# Each verifier self-skips (prints "::notice:: … skipped" and exits 0) when its creds
# are unset, so this stays green in forks / secret-less CI. Locally it hydrates creds
# from get-secret. Exit 1 if ANY verifier reports a failure (non-zero exit OR a 🔴 /
# "N divergence(s)" marker in its output) — wireable into CI or a monitoring cron.
#
# Usage: bash e2e/admin-verify/run-all-verifiers.sh
#   Creds (auto-hydrated from get-secret if present, else pass via env):
#     E2E_API_KEY               — the curl verifiers (analytics/beacon/newsletter/mutations)
#     BROWSERBASE_API_KEY,
#     BROWSERBASE_PROJECT_ID,
#     E2E_TEST_PASSWORD         — the Browserbase verifiers (reconcile-surfaces, forms)

set -uo pipefail

scriptDir="$(cd "$(dirname "$0")" && pwd)"
getSecret="/Users/Apple/.local/bin/get-secret"

# Best-effort credential hydration — silent no-op when get-secret is absent (CI).
if [ -x "$getSecret" ]; then
  export E2E_API_KEY="${E2E_API_KEY:-$("$getSecret" E2E_API_KEY 2>/dev/null || true)}"
  export BROWSERBASE_API_KEY="${BROWSERBASE_API_KEY:-$("$getSecret" BROWSERBASE_API_KEY 2>/dev/null || true)}"
  export BROWSERBASE_PROJECT_ID="${BROWSERBASE_PROJECT_ID:-$("$getSecret" BROWSERBASE_PROJECT_ID 2>/dev/null || true)}"
  export E2E_TEST_PASSWORD="${E2E_TEST_PASSWORD:-$("$getSecret" E2E_TEST_PASSWORD 2>/dev/null || true)}"
fi

# name:script — fast curl verifiers first, slower Browserbase ones last.
verifiers=(
  "analytics-visit-count:verify-analytics-visit-count-causal.mjs"
  "beacon-funnel:verify-beacon-funnel-causal.mjs"
  "newsletter-subscribe:verify-newsletter-causal.mjs"
  "admin-mutations:verify-mutations-causal.mjs"
  "admin-surfaces-read:reconcile-surfaces.mjs"
  "forms-ingest:verify-forms-causal.mjs"
)

passCount=0
failCount=0
skipCount=0
failed=()

for entry in "${verifiers[@]}"; do
  name="${entry%%:*}"
  script="${entry#*:}"
  printf '\n── %s (%s) ──────────────────────────────\n' "$name" "$script"
  output="$(node "$scriptDir/$script" 2>&1)"
  code=$?
  printf '%s\n' "$output"

  if printf '%s' "$output" | grep -q '::notice::.*skipped'; then
    skipCount=$((skipCount + 1))
    printf '   → SKIPPED (creds unset)\n'
  elif [ "$code" -ne 0 ] || printf '%s' "$output" | grep -qE '🔴|[1-9][0-9]* divergence\(s\) found'; then
    failCount=$((failCount + 1))
    failed+=("$name")
    printf '   → FAILED (exit=%d)\n' "$code"
  else
    passCount=$((passCount + 1))
    printf '   → PASS\n'
  fi
done

printf '\n═══════════ VERIFIER SUMMARY ═══════════\n'
printf 'pass=%d  fail=%d  skip=%d  (of %d)\n' "$passCount" "$failCount" "$skipCount" "${#verifiers[@]}"
if [ "$failCount" -gt 0 ]; then
  printf '🔴 FAILED: %s\n' "${failed[*]}"
  exit 1
fi
printf '✅ all run verifiers green\n'
exit 0
