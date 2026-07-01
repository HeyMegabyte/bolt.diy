#!/usr/bin/env bash
# Checkmate entrypoint — start supervisor (backend + nginx)
# MongoDB is external (Atlas) — no local mongod needed
set -euo pipefail
echo "[entrypoint] Starting Checkmate (MongoDB Atlas)..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf --nodaemon
