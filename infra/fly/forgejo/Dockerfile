# Custom Forgejo image — pre-configures fully on first boot, never triggers the
# web install flow. This avoids Forgejo's connection-closing config reload that
# permanently breaks Fly proxy connectivity.

FROM alpine:3.22

RUN apk add --no-cache \
    bash ca-certificates curl git git-lfs gnupg openssh-keygen su-exec sqlite

RUN addgroup -g 1000 git && \
    adduser -D -h /data/git -u 1000 -G git git && \
    mkdir -p /data/gitea /data/git /app/gitea && \
    chown -R git:git /data /app/gitea

RUN curl -sSL "https://codeberg.org/forgejo/forgejo/releases/download/v10.0.0/forgejo-10.0.0-linux-amd64" \
    -o /app/gitea/gitea && \
    chmod +x /app/gitea/gitea && \
    ln -s /app/gitea/gitea /usr/local/bin/gitea

# Entrypoint: pre-configure on first boot, then run Forgejo directly (no restart loop).
RUN printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    'BIN=/app/gitea/gitea' \
    'CONF=/data/gitea/conf/app.ini' \
    'WORK=/data/gitea' \
    'ADMIN_USER="${FORGEJO_ADMIN_USER:-professormanhattan}"' \
    'ADMIN_PASS="${FORGEJO_ADMIN_PASS:-}"' \
    'ADMIN_EMAIL="${FORGEJO_ADMIN_EMAIL:-hey@megabyte.space}"' \
    'mkdir -p /data/gitea/conf /data/gitea/log /data/git /data/git/lfs /data/ssh' \
    'chown -R git:git /data 2>/dev/null || true' \
    'if [ ! -f /data/.forgejo-bootstrapped ]; then' \
    '  echo "[bootstrap] First boot — generating config"' \
    '  su-exec git:git "$BIN" generate config APP_NAME="Forgejo" RUN_MODE=prod WORK_PATH="$WORK" CUSTOM_PATH="$WORK" --config "$CONF"' \
    '  echo "[bootstrap] Running database migrations"' \
    '  su-exec git:git "$BIN" migrate --config "$CONF" --work-path "$WORK"' \
    '  echo "[bootstrap] Creating admin user"' \
    '  if [ -n "$ADMIN_PASS" ]; then' \
    '    su-exec git:git "$BIN" admin user create --admin --username "$ADMIN_USER" --password "$ADMIN_PASS" --email "$ADMIN_EMAIL" --must-change-password=false --config "$CONF" --work-path "$WORK"' \
    '    echo "[bootstrap] Admin user $ADMIN_USER created"' \
    '  else' \
    '    echo "[bootstrap] WARNING: FORGEJO_ADMIN_PASS not set — no admin created"' \
    '  fi' \
    '  echo "[bootstrap] Locking installation"' \
    '  su-exec git:git "$BIN" admin auth add-oauth --config "$CONF" --work-path "$WORK" 2>/dev/null || true' \
    '  touch /data/.forgejo-bootstrapped' \
    '  echo "[bootstrap] Complete — starting Forgejo"' \
    'fi' \
    '# Set INSTALL_LOCK=true in app.ini if not already' \
    'if grep -q "INSTALL_LOCK = false" "$CONF" 2>/dev/null; then' \
    '  sed -i "s/INSTALL_LOCK = false/INSTALL_LOCK = true/" "$CONF"' \
    'fi' \
    'echo "[entrypoint] Starting Forgejo web"' \
    'exec su-exec git:git "$BIN" web --config "$CONF" --work-path "$WORK"' \
    > /entrypoint.sh && chmod +x /entrypoint.sh

VOLUME /data
WORKDIR /data/gitea
EXPOSE 3000 22

ENTRYPOINT ["/entrypoint.sh"]
