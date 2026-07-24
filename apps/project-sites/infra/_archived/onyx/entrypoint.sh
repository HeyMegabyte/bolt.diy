#!/bin/sh
set -e

echo "=== Onyx entrypoint starting ==="

# Build REDIS_URL from components (Onyx needs this for some paths)
if [ -n "${REDIS_PASSWORD:-}" ] && [ -n "${REDIS_HOST:-}" ]; then
  proto="redis"
  [ "${REDIS_SSL:-}" = "true" ] && proto="rediss"
  export REDIS_URL="${proto}://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT:-6379}"
fi

# Web server needs INTERNAL_URL to connect to the API
export INTERNAL_URL="${INTERNAL_URL:-http://127.0.0.1:8081}"

echo "INTERNAL_URL=$INTERNAL_URL"
echo "POSTGRES_HOST=$POSTGRES_HOST"

# Start the backend's supervisor (celery workers + our onyx-services.conf programs)
echo "=== Starting supervisord ==="
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
