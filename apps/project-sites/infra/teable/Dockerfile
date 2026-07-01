ARG TEABLE_VERSION=latest
# --platform=linux/amd64 pinned: CF Containers run native amd64 (firecracker).
# Cross-built arm64 images silently exit → "Container crashed while checking for ports".
FROM --platform=linux/amd64 ghcr.io/teableio/teable:${TEABLE_VERSION}

# Cache-bust so wrangler computes a NEW image tag and forces a fresh native build
# on the amd64 CI runner instead of reusing a prior QEMU-cross-built image.
ARG CACHEBUST=2026-07-01-teable-v5

WORKDIR /app

# Teable image is Debian-based (bookworm), nodejs user. Keep original entrypoint.
# The Worker injects env vars via Container DO envVars. Teable auto-runs migrations
# on startup (the teable-db-migrate image was deprecated in favor of in-app migration).

EXPOSE 3000
