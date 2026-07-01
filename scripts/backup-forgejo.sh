#!/usr/bin/env bash
# backup-forgejo.sh — Dump Forgejo data (DB + config + repos) and upload to R2
#
# Usage:
#   ./scripts/backup-forgejo.sh
#   DRY_RUN=1 ./scripts/backup-forgejo.sh
#
# Prerequisites:
#   - flyctl authenticated
#   - aws CLI or wrangler for R2 upload (optional — dump is saved locally too)
#
# Output:
#   - Local: ./backups/forgejo-YYYY-MM-DD-HHMMSS.zip
#   - R2:    r2://projectsites-backups/forgejo/YYYY-MM-DD/forgejo-dump.zip
#
# Schedule: Run daily via cron or scheduled Fly machine.

set -euo pipefail

readonly APP_NAME="${APP_NAME:-projectsites-forgejo}"
readonly BACKUP_DIR="${BACKUP_DIR:-./backups}"
readonly R2_BUCKET="${R2_BUCKET:-projectsites-backups}"
readonly R2_PREFIX="${R2_PREFIX:-forgejo}"
readonly DRY_RUN="${DRY_RUN:-0}"
readonly TIMESTAMP
TIMESTAMP=$(date -u +%Y-%m-%d-%H%M%S)

log() { printf '[backup-forgejo] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }
run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '[DRY_RUN] %s\n' "$*"
  else
    "$@"
  fi
}

main() {
  log "Starting Forgejo backup — app=${APP_NAME}, ts=${TIMESTAMP}"

  mkdir -p "${BACKUP_DIR}"

  # ------------------------------------------------------------------
  # 1. Run forgejo dump inside the Fly machine (includes DB + config + repos)
  # ------------------------------------------------------------------
  log "Running forgejo dump on Fly machine..."
  local MACHINE_ID
  MACHINE_ID=$(flyctl machine list --app "${APP_NAME}" --json 2>/dev/null \
    | python3 -c "import sys,json; m=json.load(sys.stdin); print(m[0]['id'])" 2>/dev/null || true)

  if [[ -z "${MACHINE_ID:-}" ]]; then
    die "No running machine found for app ${APP_NAME}"
  fi

  # Generate dump inside the container
  run flyctl machine exec "${MACHINE_ID}" \
    --app "${APP_NAME}" \
    --timeout 300 \
    /bin/sh -c "su - git -c '/app/gitea/gitea dump --config /data/gitea/conf/app.ini --work-path /data/gitea --file /data/forgejo-dump-${TIMESTAMP}.zip' 2>&1"

  # ------------------------------------------------------------------
  # 2. Download dump from machine via SFTP
  # ------------------------------------------------------------------
  log "Downloading dump from Fly machine..."
  local DUMP_FILE="${BACKUP_DIR}/forgejo-${TIMESTAMP}.zip"

  if [[ "${DRY_RUN}" != "1" ]]; then
    # Use flyctl ssh to copy the file
    flyctl ssh issue --app "${APP_NAME}" --command "cat /data/forgejo-dump-${TIMESTAMP}.zip" > "${DUMP_FILE}" 2>/dev/null \
      || die "Failed to download dump from Fly machine"

    # Clean up dump on machine
    flyctl machine exec "${MACHINE_ID}" \
      --app "${APP_NAME}" \
      --timeout 30 \
      /bin/rm "/data/forgejo-dump-${TIMESTAMP}.zip" 2>/dev/null || true
  fi

  log "Local dump: ${DUMP_FILE} ($(du -h "${DUMP_FILE}" 2>/dev/null | cut -f1 || echo 'unknown'))"

  # ------------------------------------------------------------------
  # 3. Upload to R2
  # ------------------------------------------------------------------
  if command -v aws >/dev/null 2>&1; then
    log "Uploading to R2 (${R2_BUCKET}/${R2_PREFIX}/${TIMESTAMP}/)..."
    # R2 S3-compatible endpoint — uses AWS CLI with R2 credentials
    run aws s3 cp "${DUMP_FILE}" \
      "s3://${R2_BUCKET}/${R2_PREFIX}/${TIMESTAMP}/forgejo-dump.zip" \
      --endpoint-url "${R2_ENDPOINT_URL:-https://account.r2.cloudflarestorage.com}" \
      2>/dev/null || log "R2 upload skipped (AWS CLI or R2 creds not configured)"
  elif command -v wrangler >/dev/null 2>&1; then
    log "Uploading to R2 via wrangler..."
    run npx wrangler r2 object put "${R2_BUCKET}/${R2_PREFIX}/${TIMESTAMP}/forgejo-dump.zip" \
      --file "${DUMP_FILE}" --remote 2>/dev/null || log "R2 upload skipped (wrangler auth required)"
  else
    log "R2 upload skipped — install aws CLI or wrangler"
  fi

  # ------------------------------------------------------------------
  # 4. Prune old local backups (keep last 7 days)
  # ------------------------------------------------------------------
  log "Pruning local backups older than 7 days..."
  find "${BACKUP_DIR}" -name "forgejo-*.zip" -mtime +7 -delete 2>/dev/null || true

  log ""
  log "Backup complete: ${DUMP_FILE}"
  log ""
  log "Restore:"
  log "  1. Deploy fresh Forgejo app"
  log "  2. SFTP dump to /data/"
  log "  3. flyctl ssh console -C \"su - git -c '/app/gitea/gitea restore --config /data/gitea/conf/app.ini --work-path /data/gitea --file /data/forgejo-dump-${TIMESTAMP}.zip'\""
}

main "$@"
