# Onyx all-in-one — Fly.io at onyx.projectsites.dev
FROM onyxdotapp/onyx-backend:latest AS backend
FROM onyxdotapp/onyx-web-server:latest AS web

FROM backend

# Install Node.js + nginx
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gnupg nginx \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default \
    && mkdir -p /tmp/nginx /var/log/onyx

# Copy web server
COPY --from=web /app /app/web

# Our additional supervisor programs
COPY onyx-services.conf /etc/supervisor/conf.d/onyx-services.conf

# Add include directive to pick up our config file
RUN echo '[include]' >> /etc/supervisor/conf.d/supervisord.conf \
    && echo 'files = /etc/supervisor/conf.d/onyx-services.conf' >> /etc/supervisor/conf.d/supervisord.conf

COPY nginx.conf /etc/nginx/nginx.conf

# Entrypoint: start the backend's supervisor
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
