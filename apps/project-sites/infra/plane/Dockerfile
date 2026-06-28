ARG PLANE_VERSION=v1.3.1
FROM --platform=$BUILDPLATFORM tonistiigi/binfmt AS binfmt

# **************************************************
#  STAGE 0: Image Loading
# **************************************************
# --platform=linux/amd64 pinned on EVERY runtime-contributing stage: CF Containers run
# native amd64 (firecracker). A QEMU-cross-build on an arm64 host produces musl/Alpine
# binaries that "work" under emulation locally but exit on native amd64 → the container
# never binds :8080 → "Container crashed while checking for ports". Pin amd64 everywhere so
# local + CI + CF all produce/run the identical native-amd64 image. Build on amd64 CI.
FROM --platform=linux/amd64 node:22-alpine AS node

FROM --platform=linux/amd64 makeplane/plane-frontend:${PLANE_VERSION} AS web-img
FROM --platform=linux/amd64 makeplane/plane-backend:${PLANE_VERSION} AS backend-img
FROM --platform=linux/amd64 makeplane/plane-space:${PLANE_VERSION} AS space-img
FROM --platform=linux/amd64 makeplane/plane-admin:${PLANE_VERSION} AS admin-img
FROM --platform=linux/amd64 makeplane/plane-live:${PLANE_VERSION} AS live-img
FROM --platform=linux/amd64 makeplane/plane-proxy:${PLANE_VERSION} AS proxy-img

# **************************************************
#  STAGE 1: Runner
# **************************************************
FROM --platform=linux/amd64 python:3.12.10-alpine AS runner

# Cache-bust so wrangler computes a NEW image tag and forces a fresh native build on the
# amd64 CI runner instead of reusing the prior QEMU-cross-built image ("skipping push").
ARG CACHEBUST=2026-06-28-native-amd64

WORKDIR /app

RUN apk add --no-cache \
    "libpq" \
    "libxslt" \
    "xmlsec"


COPY --from=node /usr/lib /usr/lib
COPY --from=node /usr/local/lib /usr/local/lib
COPY --from=node /usr/local/include /usr/local/include
COPY --from=node /usr/local/bin /usr/local/bin

COPY --from=web-img /usr/share/nginx/html /app/web
COPY --from=space-img /app /app/space
COPY --from=admin-img /usr/share/nginx/html/god-mode /app/admin
COPY --from=live-img /app /app/live

RUN rm -rf /app/space/apps/space/.next/cache

COPY --from=proxy-img /usr/bin/caddy /usr/bin/caddy
COPY dist/Caddyfile /app/proxy/Caddyfile

COPY --from=backend-img /code /app/backend
COPY --from=backend-img /usr/local/lib/python3.12/site-packages/ /usr/local/lib/python3.12/site-packages/
COPY --from=backend-img /usr/local/bin/ /usr/local/bin/

RUN apk add --no-cache nss-tools bash curl uuidgen ncdu vim

RUN pip install supervisor
RUN mkdir -p /etc/supervisor/conf.d

COPY start.sh /app/start.sh
COPY dist/plane.env /app/plane.env
COPY supervisor.conf /etc/supervisor/conf.d/supervisor.conf

RUN mkdir -p /app/logs/access && \
    mkdir -p /app/logs/error && \
    mkdir -p /app/data && \
    chmod +x /app/start.sh

VOLUME ["/app/data", "/app/logs"]

EXPOSE 8080

CMD ["/app/start.sh"] 
