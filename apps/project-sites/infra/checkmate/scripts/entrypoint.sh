#!/usr/bin/env bash
# Checkmate entrypoint — initialize MongoDB data dir and start supervisor
# mongod (local) → checkmate-server → nginx
set -euo pipefail
echo "[entrypoint] Starting Checkmate stack (local MongoDB)..."
if [ ! -f /data/db/.mongodb_initialized ]; then
  echo "[entrypoint] First boot — initializing MongoDB data directory..."
  touch /data/db/.mongodb_initialized
fi
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf --nodaemon
