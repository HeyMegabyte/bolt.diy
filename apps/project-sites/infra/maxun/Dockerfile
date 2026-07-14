# Maxun unified: backend + frontend via nginx, R2 for storage
# Two-stage build: frontend built with correct URLs, then combined with backend

# ─── Stage 1: Build frontend ────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /src
RUN apk add --no-cache git

# Pin to develop — replace with a release tag for deterministic builds
ARG MAXUN_VERSION=v0.0.43
RUN git clone --depth 1 --branch ${MAXUN_VERSION} https://github.com/getmaxun/maxun.git /src

# Install and build frontend with production URLs
RUN cp package.frontend.json package.json && npm install --legacy-peer-deps
ENV VITE_PUBLIC_URL=https://maxun.projectsites.dev
ENV VITE_BACKEND_URL=https://maxun.projectsites.dev
RUN npm run build

# ─── Stage 2: Final image ────────────────────────────────────────────────────
FROM getmaxun/maxun-backend:latest

USER root

# Install nginx + supervisor only (no MinIO — using R2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx supervisor \
    && rm -rf /var/lib/apt/lists/*

# Copy and apply R2 storage patch
COPY patch-minio-for-r2.sh /tmp/patch-minio-for-r2.sh
RUN chmod +x /tmp/patch-minio-for-r2.sh && /tmp/patch-minio-for-r2.sh && rm /tmp/patch-minio-for-r2.sh

# Copy frontend build from builder stage
COPY --from=frontend-builder /src/build /var/www/maxun

# Configure nginx
COPY nginx.conf /etc/nginx/sites-available/maxun
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf 2>/dev/null || true
RUN ln -sf /etc/nginx/sites-available/maxun /etc/nginx/sites-enabled/maxun
RUN mkdir -p /run/nginx /var/log/nginx /var/log/supervisor

# Supervisor (nginx + backend only — no MinIO)
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 80 8080

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
