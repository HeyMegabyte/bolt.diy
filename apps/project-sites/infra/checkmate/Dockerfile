# Checkmate — ProjectSites.dev monitoring control plane
# Multi-process Docker image: MongoDB 7.0 + Node.js backend + nginx frontend
# Deployed to Fly.io with persistent volume for MongoDB data
#
# Base image tags (pinned):
#   ghcr.io/bluewave-labs/checkmate:backend-demo  — Node.js Express server on :52345
#   ghcr.io/bluewave-labs/checkmate:frontend-demo  — nginx + React SPA on :80
#   ghcr.io/bluewave-labs/checkmate:mongo-demo     — MongoDB 7.0 on :27017

FROM ghcr.io/bluewave-labs/checkmate:backend-demo AS backend
FROM ghcr.io/bluewave-labs/checkmate:frontend-demo AS frontend

# --- Final image: Debian slim with MongoDB + nginx + Node ---
FROM node:20-slim

# Install MongoDB 7.0, nginx, supervisor, and runtime deps in one layer
# node:20-slim strips CA certificates — reinstall them before any curl/tls use
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    nginx \
    supervisor \
  && update-ca-certificates \
  && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
    | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
    > /etc/apt/sources.list.d/mongodb-org-7.0.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends mongodb-org \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/db /var/log/supervisor /var/log/mongodb /run/nginx

# Copy Checkmate backend (Node.js app at /app, runs on :52345)
COPY --from=backend /app /app

# Copy Checkmate frontend static files (built React SPA)
COPY --from=frontend /usr/share/nginx/html /usr/share/nginx/html

# Custom nginx config — serves SPA + proxies /api/* and /api-docs/* to backend
COPY nginx/default.conf /etc/nginx/sites-available/default
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Remove default nginx server block that would conflict
RUN rm -f /etc/nginx/sites-enabled/default \
  && ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# Supervisor config — manages mongod + node backend + nginx
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# MongoDB init script — creates the Checkmate database on first boot
COPY scripts/init-mongo.js /init-mongo.js
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=2048"

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf", "--nodaemon"]
