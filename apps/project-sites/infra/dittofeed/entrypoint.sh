#!/usr/bin/env bash
set -eu
echo "[entry] Proxy on :3001, Dittofeed (no Temporal) on :3000"
cd /service
node --max-old-space-size=824 ./packages/lite/dist/scripts/startLite.js --workspace-name="${WORKSPACE_NAME:-ProjectSites}" &
exec node /proxy.js
