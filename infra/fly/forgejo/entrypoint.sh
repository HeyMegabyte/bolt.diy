#!/usr/bin/env bash
# Forgejo entrypoint wrapper — runs gitea web in a restart loop.
#
# Forgejo exits cleanly (0) when it reloads its config after the web install
# completes. The official s6-based image has a multi-second restart gap that
# causes Fly proxy to permanently lose connectivity to port 3000.
#
# This wrapper restarts Forgejo immediately on clean exit, keeping the
# listening socket alive with sub-second gap.

set -euo pipefail

GITEA_BIN="${GITEA_BIN:-/app/gitea/gitea}"
GITEA_WORK_DIR="${GITEA_WORK_DIR:-/data/gitea}"

# Ensure required directories exist (first boot)
mkdir -p /data/gitea/conf /data/gitea/log /data/git /data/git/lfs /data/ssh
chown -R git:git /data 2>/dev/null || true

# Generate default app.ini from env vars if not present
if [ ! -f /data/gitea/conf/app.ini ]; then
    echo "[entrypoint] First boot — generating app.ini from environment"
    su-exec git:git "$GITEA_BIN" generate config APP_NAME="Forgejo" \
        RUN_MODE=prod \
        WORK_PATH="$GITEA_WORK_DIR" \
        CUSTOM_PATH="$GITEA_WORK_DIR" \
        --config /data/gitea/conf/app.ini
fi

echo "[entrypoint] Starting Forgejo (PID $$) — restart loop active"

# Run Forgejo in a loop. On clean exit (code 0), restart immediately.
# On non-zero exit, wait briefly then restart.
while true; do
    echo "[entrypoint] Launching gitea web..."
    su-exec git:git "$GITEA_BIN" web --config /data/gitea/conf/app.ini --work-path "$GITEA_WORK_DIR" &
    GITEA_PID=$!

    # Wait for the process to exit
    wait $GITEA_PID || EXIT_CODE=$?
    EXIT_CODE=${EXIT_CODE:-0}

    echo "[entrypoint] gitea exited with code $EXIT_CODE"

    if [ "$EXIT_CODE" -eq 0 ]; then
        # Clean exit — config reload or graceful shutdown. Restart immediately.
        echo "[entrypoint] Clean exit — restarting immediately"
        sleep 0.5
    else
        # Error exit — brief backoff then retry
        echo "[entrypoint] Error exit — restarting in 2s"
        sleep 2
    fi
done
