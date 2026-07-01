# Checkmate — ProjectSites.dev monitoring control plane (combined: MongoDB + Node + nginx)
# MongoDB runs locally with persistent Fly volume at /data/db.
# When Atlas IP whitelist is resolved, remove MongoDB and use Atlas instead.
FROM ghcr.io/bluewave-labs/checkmate:backend-demo AS backend
FROM ghcr.io/bluewave-labs/checkmate:frontend-demo AS frontend

FROM node:20-slim

# Install MongoDB 7.0, nginx, supervisor
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg nginx supervisor \
  && update-ca-certificates \
  && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
    | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
    > /etc/apt/sources.list.d/mongodb-org-7.0.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends mongodb-org \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/db /var/log/supervisor /var/log/mongodb /run/nginx

COPY --from=backend /app /app
COPY --from=frontend /usr/share/nginx/html /usr/share/nginx/html

COPY nginx/default.conf /etc/nginx/sites-available/default
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default \
  && ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256"

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf", "--nodaemon"]
