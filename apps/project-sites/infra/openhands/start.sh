#!/usr/bin/env bash
set -euo pipefail

echo "=== OpenHands Agent Canvas — ProjectSites Origin ==="

# ── State directories ────────────────────────────────────────────────────────
mkdir -p /data/openhands-state /data/projects
ln -sf /data/openhands-state /home/openhands/.openhands 2>/dev/null || true
ln -sf /data/projects /projects 2>/dev/null || true
chown -R openhands:openhands /data /home/openhands /projects 2>/dev/null || true

# ── Secrets (auto-generate if not set) ───────────────────────────────────────
if [ -z "${LOCAL_BACKEND_API_KEY:-}" ]; then
  export LOCAL_BACKEND_API_KEY="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
fi
if [ -z "${OH_SECRET_KEY:-}" ]; then
  export OH_SECRET_KEY="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
fi

# ── Start origin gateway on :8080 ────────────────────────────────────────────
echo "→ Starting origin gateway on :8080"
OPENHANDS_ORIGIN_SECRET="${OPENHANDS_ORIGIN_SECRET:-}" node /gateway.mjs &
GATEWAY_PID=$!
echo "   gateway PID: $GATEWAY_PID"

sleep 2
if ! kill -0 $GATEWAY_PID 2>/dev/null; then
  echo "ERROR: Gateway failed to start"
  exit 1
fi

# ── Start Agent Canvas via tini + original entrypoint ─────────────────────────
echo "→ Starting OpenHands Agent Canvas on :8000"
cd /
exec /usr/bin/tini -- /opt/agent-canvas/entrypoint.sh
