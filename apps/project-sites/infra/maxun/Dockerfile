# Maxun unified: backend + MinIO + frontend static files via nginx
# Multi-stage build that compiles the frontend with correct URLs,
# then combines with backend + MinIO

# ─── Stage 1: Build frontend with correct env vars ─────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /src

# Clone the maxun source at develop (pinned to build frontend)
RUN apk add --no-cache git && \
    git clone --depth 1 --branch develop https://github.com/getmaxun/maxun.git /src

# Install frontend deps
RUN cp package.frontend.json package.json && npm install --legacy-peer-deps

# Build with correct env vars
ENV VITE_PUBLIC_URL=https://maxun.projectsites.dev
ENV VITE_BACKEND_URL=https://maxun.projectsites.dev
ENV VITE_API_URL=https://maxun.projectsites.dev

RUN npm run build

# ─── Stage 2: Final image ──────────────────────────────────────────────────
FROM getmaxun/maxun-backend:latest

USER root

# Install nginx, supervisor, wget for MinIO
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx supervisor wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install MinIO binary
RUN wget -q https://dl.min.io/server/minio/release/linux-amd64/minio -O /usr/local/bin/minio \
    && chmod +x /usr/local/bin/minio \
    && mkdir -p /data/minio

# Copy frontend build from builder stage
COPY --from=frontend-builder /src/build /var/www/maxun

# Configure nginx
COPY nginx.conf /etc/nginx/sites-available/maxun
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf 2>/dev/null || true
RUN ln -sf /etc/nginx/sites-available/maxun /etc/nginx/sites-enabled/maxun
RUN mkdir -p /run/nginx /var/log/nginx /var/log/supervisor

# Remove any nginx default server that binds port 80
RUN echo "" > /etc/nginx/conf.d/default.conf 2>/dev/null || true

# Supervisor configuration
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 80 8080 9000

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
