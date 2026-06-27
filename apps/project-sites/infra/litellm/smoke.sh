#!/usr/bin/env bash
# Post-deploy smoke gate for the LiteLLM gateway (llm.megabyte.space).
# Run AFTER every `wrangler deploy` of projectsites-litellm — the gateway has 1101'd
# silently on bad config bumps before, so never trust a deploy without this green.
#
# Usage:
#   LITELLM_MASTER_KEY="$(get-secret LITELLM_MASTER_KEY)" bash smoke.sh
# Exits 0 only when the gateway is healthy + the `smart` entrypoint answers.
set -euo pipefail

BASE="${LITELLM_BASE:-https://llm.megabyte.space}"
MK="${LITELLM_MASTER_KEY:?set LITELLM_MASTER_KEY (get-secret LITELLM_MASTER_KEY)}"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
RETRIES="${SMOKE_RETRIES:-8}"   # container can cold-start after a deploy
fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }

# 1. /v1/models registered, with the `smart` adaptive_router entrypoint present.
models=""
for i in $(seq 1 "$RETRIES"); do
  if models=$(curl -fsS --max-time 30 -H "User-Agent: $UA" -H "Authorization: Bearer $MK" "$BASE/v1/models" 2>/dev/null); then break; fi
  sleep 25
done
[ -n "$models" ] || fail "/v1/models unreachable after $RETRIES tries (gateway down / 1101?)"
printf '%s' "$models" | grep -q '"smart"' || fail "'smart' entrypoint missing from /v1/models"

# 2. `smart` returns a real completion (adaptive_router booted + a provider answered).
reply=$(curl -fsS --max-time 90 -H "User-Agent: $UA" -H "Authorization: Bearer $MK" \
  -H 'Content-Type: application/json' -X POST "$BASE/v1/chat/completions" \
  --data '{"model":"smart","messages":[{"role":"user","content":"Reply with exactly: PONG"}],"max_tokens":10}') \
  || fail "smart completion request errored"
printf '%s' "$reply" | grep -q '"content"' || fail "smart completion returned no content: ${reply:0:200}"

echo "SMOKE OK — $BASE smart entrypoint healthy"
