#!/bin/bash
# Wrapper around the original Lago runner.sh — also starts nginx for the SPA
# Fly calls: ./runner.sh <command>
set -e

# Start nginx in the background (serves SPA on :80, proxies /api → :3000)
echo "[start.sh] Starting nginx..."
nginx -g 'daemon off;' &
NGINX_PID=$!
echo "[start.sh] nginx PID=$NGINX_PID"

# Delegate to the original runner.sh (starts Postgres, Redis, then runs the command)
echo "[start.sh] Starting original runner..."
exec /app/runner-orig.sh "$@"
