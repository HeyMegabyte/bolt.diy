# medusa.projectsites.dev — Medusa v2 on Cloudflare Workers Containers.
#
# Data plane (external, no persistent local disk):
#   - Postgres → Neon    (DATABASE_URL)
#   - Redis    → Upstash (REDIS_URL)
#   - Files    → R2      (S3-compatible)
#
# Single-stage: install deps, build admin, run migrations, start server.
# --platform=linux/amd64 pinned: CF firecracker is native amd64.

FROM --platform=linux/amd64 node:22-alpine

WORKDIR /app

RUN apk add --no-cache curl tini python3 make g++

# Install all deps (need dev deps for medusa build)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps 2>/dev/null || npm install --legacy-peer-deps

# Copy source and config
COPY medusa-config.ts tsconfig.json ./
COPY src/ ./src/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Build Medusa (compiles TS + admin bundle)
RUN npx medusa build

ENV NODE_ENV=production
ENV PORT=9000

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD curl -fsS http://localhost:9000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/entrypoint.sh"]
