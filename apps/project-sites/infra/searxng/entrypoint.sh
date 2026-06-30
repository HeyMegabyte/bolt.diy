#!/usr/bin/env bash
set -euo pipefail

# ── Upstash Redis URL → Valkey scheme rewrite ──────────────────────────
# SearXNG's valkey: block expects valkey:// or valkeys:// schemes.
# Upstash Redis URLs use redis:// or rediss://. Rewrite the scheme so
# the valkey client accepts the connection string.
if [[ -n "${SEARXNG_VALKEY_URL:-}" ]]; then
  if [[ "$SEARXNG_VALKEY_URL" == redis://* ]]; then
    export SEARXNG_VALKEY_URL="valkey://${SEARXNG_VALKEY_URL#redis://}"
  elif [[ "$SEARXNG_VALKEY_URL" == rediss://* ]]; then
    export SEARXNG_VALKEY_URL="valkeys://${SEARXNG_VALKEY_URL#rediss://}"
  fi
fi

# ── Fix ownership on mounted config files ──────────────────────────────
# CF Containers mount files owned by root; SearXNG expects searxng:searxng.
# The stock image's docker-entrypoint.sh handles this via FORCE_OWNERSHIP=1
# but we ensure it here as a safety net.
chown -R searxng:searxng /etc/searxng/ 2>/dev/null || true

# ── Delegate to the stock SearXNG entrypoint ───────────────────────────
exec /usr/local/searxng/dockerfiles/docker-entrypoint.sh "$@"
