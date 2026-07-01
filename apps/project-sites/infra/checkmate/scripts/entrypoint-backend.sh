#!/usr/bin/env bash
set -euo pipefail
echo "[entrypoint] Starting Checkmate backend (MongoDB + Node.js)..."
if [ ! -f /data/db/.mongodb_initialized ]; then
  touch /data/db/.mongodb_initialized
fi
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf --nodaemon
