#!/bin/sh
# Backend container entrypoint: run DB migrations once (idempotent) before starting the
# api+worker+beat supervisord set. Migrations are safe to re-run on every (re)boot.
set -e
cd /code
python manage.py migrate --noinput 2>/dev/null || /code/bin/docker-entrypoint-migrator.sh || true
exec supervisord -c /etc/supervisor/conf.d/plane.conf -n
