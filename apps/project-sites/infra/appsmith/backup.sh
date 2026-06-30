#!/usr/bin/env bash
# Nightly backup of Appsmith data from Fly.io persistent volume.
# Writes a tar.gz to a local directory. Optionally push to R2.
# Schedule: 0 3 * * * (3 AM daily) via cron or /loop
set -euo pipefail

APP="projectsites-appsmith"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BACKUP_FILE="$BACKUP_DIR/appsmith-$TIMESTAMP.tar.gz"
KEEP_DAYS="${KEEP_DAYS:-7}"

mkdir -p "$BACKUP_DIR"

echo "==> Backing up Appsmith stacks to $BACKUP_FILE"

# 1. Snapshot the volume via flyctl SSH
#    Appsmith stores everything under /appsmith-stacks
flyctl ssh console --app "$APP" --command \
  "tar czf /tmp/appsmith-backup.tar.gz -C /appsmith-stacks ." || {
  echo "FAIL: SSH into Fly machine failed — is the app running?"
  exit 1
}

# 2. Copy the tarball out
flyctl ssh sftp get /tmp/appsmith-backup.tar.gz "$BACKUP_FILE" --app "$APP" || {
  echo "FAIL: SFTP transfer failed"
  exit 1
}

# 3. Clean up the remote temp file
flyctl ssh console --app "$APP" --command "rm /tmp/appsmith-backup.tar.gz" || true

echo "--> Backup saved: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# 4. Optionally push to R2
if [ "${R2_BACKUP:-false}" = "true" ]; then
  echo "--> Pushing backup to R2 (project-sites-production/appsmith-backups/)"
  npx wrangler r2 object put project-sites-production/appsmith-backups/"$(basename "$BACKUP_FILE")" \
    --file "$BACKUP_FILE" \
    --content-type application/gzip \
    --remote
  echo "--> R2 upload complete"
fi

# 5. Prune old backups
echo "--> Pruning backups older than $KEEP_DAYS days"
find "$BACKUP_DIR" -name 'appsmith-*.tar.gz' -mtime "+$KEEP_DAYS" -delete

echo "==> Backup complete"
