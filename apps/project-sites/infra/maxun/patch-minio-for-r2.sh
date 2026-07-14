#!/usr/bin/env bash
# Patch maxun for R2 storage + Postgres SSL compatibility
# Applied during Docker build

set -euo pipefail

# ─── 1. Patch compiled mino.js for R2 ────────────────────────────────────────

MINO_TARGET="server/dist/server/src/storage/mino.js"
if [ -f "$MINO_TARGET" ]; then
  # Make useSSL configurable (target compiled JS)
  sed -i 's/useSSL: false/useSSL: process.env.MINIO_USE_SSL === "true"/' "$MINO_TARGET"

  # Wrap setBucketPolicy in try/catch (R2 doesn't support S3 bucket policies)
  sed -i 's/await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));/try { await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy)); } catch (e) { console.warn("[maxun] setBucketPolicy not supported (R2):", e.message); }/' "$MINO_TARGET"

  # Add region parameter
  sed -i 's/new Client({/new Client({ region: process.env.MINIO_REGION || "us-east-1",/' "$MINO_TARGET"

  echo "[patch] mino.js patched for R2"
  grep -c "useSSL\|region\|setBucketPolicy" "$MINO_TARGET"
else
  echo "[patch] WARNING: mino.js not found at $MINO_TARGET"
fi

# ─── 2. Patch compiled db.js for Postgres SSL ───────────────────────────────

DB_TARGET="server/dist/server/src/storage/db.js"
if [ -f "$DB_TARGET" ]; then
  sed -i 's|/${process.env.DB_NAME}`|/${process.env.DB_NAME}?sslmode=require`|' "$DB_TARGET"
  echo "[patch] db.js patched for Postgres SSL"
  grep "sslmode" "$DB_TARGET" | head -3
else
  echo "[patch] WARNING: db.js not found at $DB_TARGET"
  find . -name "db.js" -path "*/storage/*" 2>/dev/null | head -5
fi
