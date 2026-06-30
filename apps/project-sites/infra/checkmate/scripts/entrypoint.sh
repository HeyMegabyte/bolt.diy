#!/usr/bin/env bash
# Checkmate entrypoint — initialize MongoDB data dir and start supervisor
set -euo pipefail

echo "[entrypoint] Starting Checkmate stack..."

# Ensure MongoDB data directory exists on the persistent volume
if [ ! -f /data/db/.mongodb_initialized ]; then
  echo "[entrypoint] First boot — initializing MongoDB data directory..."
  # mongod will create the WiredTiger files on first start
  touch /data/db/.mongodb_initialized
fi

# Start supervisor (mongod → backend → nginx)
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf --nodaemon
