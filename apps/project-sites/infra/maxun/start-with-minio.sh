#!/usr/bin/env bash
set -euo pipefail

echo "[maxun] Starting MinIO in background..."
MINIO_ROOT_USER="${MINIO_ACCESS_KEY:-minioadmin}" \
MINIO_ROOT_PASSWORD="${MINIO_SECRET_KEY:-minioadmin}" \
minio server /data/minio --console-address ":9001" &

# Wait for MinIO to be ready
echo "[maxun] Waiting for MinIO health..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:9000/minio/health/live > /dev/null 2>&1; then
    echo "[maxun] MinIO is ready"
    break
  fi
  sleep 1
done

# Run the actual server (npm run server)
echo "[maxun] Starting Maxun backend..."
exec npm run server
