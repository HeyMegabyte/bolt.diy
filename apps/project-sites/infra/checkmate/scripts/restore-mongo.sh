#!/usr/bin/env bash
# Restore Checkmate MongoDB from a backup file
# Usage: bash scripts/restore-mongo.sh <backup-file.gz> [--app projectsites-checkmate]
# WARNING: This DROPS and REPLACES the current uptime_db. Use with caution.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: restore-mongo.sh <backup-file.gz> [--app APP_NAME]"
  echo "  Restores a Checkmate MongoDB backup created by backup-mongo.sh"
  exit 1
fi

BACKUP_FILE="$1"
APP="${APP:-projectsites-checkmate}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "=== Checkmate MongoDB Restore ==="
echo "App: $APP"
echo "Backup: $BACKUP_FILE"
echo ""
echo "⚠️  WARNING: This will DROP and REPLACE the current uptime_db database."
echo "   Active monitors will be paused during restore."
read -rp "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo "→ Restoring..."
cat "$BACKUP_FILE" | flyctl ssh console --app "$APP" --command \
  "mongorestore --db uptime_db --archive --gzip --drop" 2>/dev/null || {
    echo "ERROR: mongorestore failed."
    exit 1
  }

echo "→ Restarting Checkmate server..."
flyctl ssh console --app "$APP" --command \
  "supervisorctl restart checkmate-server" 2>/dev/null || true

echo "=== Restore complete ==="
echo "Verify: open https://monitor.projectsites.dev and confirm monitors are back."
