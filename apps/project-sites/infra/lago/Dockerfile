# Lago billing — CF Workers Container (api + front, single image)
# Architecture: lago-api (Rails :3000) serves lago-front (React SPA) from public/
# lago-worker (Sidekiq) → Fly.io (always-on, same Neon + Upstash)
#
# Base: Lago's own Dockerfile with front-end baked in.
# Multi-stage: build the front-end SPA → copy into Rails public/ → single port.
FROM ghcr.io/getlago/lago-api:latest AS api

# ── Front-end build stage ────────────────────────────────────────────────
FROM node:22-slim AS frontend-build
WORKDIR /frontend
RUN apt-get update && apt-get install -y --no-install-recommends git && \
    git clone --depth 1 --branch main https://github.com/getlago/lago-front.git . && \
    npm ci --ignore-scripts && \
    # Point the SPA at the API (runtime: the container's own :3000, or the public URL)
    echo "NEXT_PUBLIC_LAGO_API_URL=" > .env.production && \
    npm run build

# ── Final image: Rails API + baked-in front-end SPA ───────────────────────
FROM api
# Copy the built front-end into Rails public/ so the API serves it directly
COPY --from=frontend-build /frontend/out /app/public
# Override the API to serve the SPA at / (catch-all → index.html for SPA routing)
# Rails already serves public/ at / — no nginx needed.

# Port matches the container convention (Lago API listens on 3000)
EXPOSE 3000
ENV PORT=3000

# Entrypoint: standard Rails server (the base image already sets this)
# The container DO will probe :3000 for readiness.
# Health: GET /health returns 200 if Rails + DB + Redis are all reachable.
