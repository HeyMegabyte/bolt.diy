#!/usr/bin/env sh
set -euo pipefail

echo "[medusa] entrypoint starting — NODE_ENV=$NODE_ENV PORT=$PORT"
echo "[medusa] worker mode: ${MEDUSA_WORKER_MODE:-server}"

# Run DB migrations before starting
echo "[medusa] running migrations..."
npx medusa db:migrate || echo "[medusa] WARNING: migrations failed, continuing..."

# Start Medusa
if [ "${MEDUSA_WORKER_MODE:-server}" = "worker" ]; then
  echo "[medusa] starting MEDUSA WORKER (admin disabled)..."
  exec npx medusa start
else
  echo "[medusa] starting MEDUSA SERVER + ADMIN on :$PORT..."
  exec npx medusa start
fi
