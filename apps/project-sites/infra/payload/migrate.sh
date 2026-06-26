#!/usr/bin/env bash
# Payload (cms.projectsites.dev) schema migrations against Neon.
#
# WHY THIS EXISTS: Payload's postgres adapter `push: true` is a DEV-ONLY no-op —
# in production (NODE_ENV=production, as the container runs) it does NOT create the
# schema. So the schema must be applied via `payload migrate`. The local Mac runs
# Node 26 which breaks Payload's tsx loader, so we run the CLI inside a Node-22
# container. Run this once for the initial schema and again whenever a collection
# changes (it generates a new migration, then applies it to Neon).
#
# Usage:  ./migrate.sh            # create (if schema changed) + apply
#         ./migrate.sh apply      # apply existing migrations only
set -euo pipefail
cd "$(dirname "$0")"

DOCKER="${WRANGLER_DOCKER_BIN:-/usr/local/bin/docker}"
PG="${DATABASE_URI:-postgresql://neondb_owner:npg_wEsrfOcpW3M4@ep-round-wildflower-aigybxdk-pooler.c-4.us-east-1.aws.neon.tech/payload?sslmode=require}"
MODE="${1:-create}"

run='rm -rf node_modules && npm install --legacy-peer-deps --no-audit --no-fund >/tmp/i.log 2>&1'
if [ "$MODE" = "create" ]; then
  run="$run && node_modules/.bin/payload migrate:create auto --force-accept-warning; node_modules/.bin/payload migrate"
else
  run="$run && node_modules/.bin/payload migrate"
fi

"$DOCKER" run --rm \
  -v "$PWD/app":/app -w /app \
  -e DATABASE_URI="$PG" \
  -e PAYLOAD_SECRET="migration-only-secret-not-used-at-runtime" \
  -e NODE_OPTIONS="--no-deprecation" \
  node:22-bookworm-slim sh -c "$run"
