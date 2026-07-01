#!/bin/sh
set -eu

# ── Upstash Redis URL → Valkey scheme rewrite ──────────────────────────
# SearXNG's valkey: block expects valkey:// or valkeys:// schemes.
# Upstash Redis URLs use redis:// or rediss://. Rewrite the scheme so
# the valkey client accepts the connection string.
if [ -n "${SEARXNG_VALKEY_URL:-}" ]; then
  case "$SEARXNG_VALKEY_URL" in
    redis://*)  SEARXNG_VALKEY_URL="valkey://${SEARXNG_VALKEY_URL#redis://}" ;;
    rediss://*) SEARXNG_VALKEY_URL="valkeys://${SEARXNG_VALKEY_URL#rediss://}" ;;
  esac
  export SEARXNG_VALKEY_URL
fi

# ── Delegate to the stock SearXNG entrypoint ───────────────────────────
# Stock entrypoint handles chown (FORCE_OWNERSHIP=1) + config setup + granian start.
exec /usr/local/searxng/entrypoint.sh "$@"
