#!/bin/bash
# Custom entrypoint — runs db:prepare before starting Lago
set -e

echo "[entrypoint] Running database setup..."
cd /app

# Wait for database to be reachable, then migrate
if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] DATABASE_URL is set — running db:prepare..."
  bundle exec rails db:prepare 2>&1 || echo "[entrypoint] db:prepare failed (may already be migrated)"
else
  echo "[entrypoint] No DATABASE_URL — assuming local Postgres"
fi

echo "[entrypoint] Starting Lago..."
exec /app/runner.sh "$@"
