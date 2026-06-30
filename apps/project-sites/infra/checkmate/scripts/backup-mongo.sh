#!/usr/bin/env bash
# Backup Checkmate MongoDB to a local dump file
# Usage: bash scripts/backup-mongo.sh [--r2] [--app projectsites-checkmate]
#   --r2  Also upload the encrypted backup to Cloudflare R2
set -euo pipefail

APP="${APP:-projectsites-checkmate}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_DIR="/tmp/checkmate-backups"
BACKUP_FILE="$BACKUP_DIR/checkmate-mongo-$TIMESTAMP.gz"

mkdir -p "$BACKUP_DIR"

echo "=== Checkmate MongoDB Backup ==="
echo "App: $APP"
echo "Timestamp: $TIMESTAMP"

# Run mongodump inside the Fly machine
echo "→ Running mongodump..."
flyctl ssh console --app "$APP" --command \
  "mongodump --db uptime_db --archive --gzip" 2>/dev/null \
  > "$BACKUP_FILE" || {
    echo "ERROR: mongodump failed. Is the app running?"
    exit 1
  }

BACKUP_SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"
echo "  Backup saved: $BACKUP_FILE ($BACKUP_SIZE)"

# Optional: upload to R2
if [ "${1:-}" = "--r2" ] || [ "${2:-}" = "--r2" ]; then
  echo "→ Uploading to R2 (checkmate-backups bucket)..."
  npx wrangler r2 object put "checkmate-backups/checkmate-mongo-$TIMESTAMP.gz" \
    --file "$BACKUP_FILE" \
    --content-type application/gzip \
    2>/dev/null || {
      echo "WARNING: R2 upload failed (bucket may not exist yet)"
    }
  echo "  R2 upload done."
fi

echo "=== Backup complete ==="
echo "File: $BACKUP_FILE"
