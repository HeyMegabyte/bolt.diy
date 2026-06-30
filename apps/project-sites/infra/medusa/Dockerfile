# medusa.projectsites.dev — Medusa v2 commerce on Cloudflare Workers Containers.
#
# Data plane (external, no persistent local disk):
#   - Postgres → Neon    (DATABASE_URL)
#   - Redis    → Upstash (REDIS_URL + CACHE/EVENTS/WORKFLOW/LOCKING)
#   - Files    → R2      (S3-compatible file provider)
#
# Multi-stage: build deps → production runtime with only the built output.
# --platform=linux/amd64 pinned: CF firecracker is native amd64.

# ── Stage 0: Builder ──
FROM --platform=linux/amd64 node:22-alpine AS builder
WORKDIR /app

# Install build deps
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --omit=dev --ignore-scripts 2>/dev/null || npm install --legacy-peer-deps --ignore-scripts
COPY . .
RUN npm run build 2>/dev/null || npx medusa build

# ── Stage 1: Runner ──
FROM --platform=linux/amd64 node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache curl tini

# Copy production node_modules + built .medusa output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.medusa ./.medusa
COPY --from=builder /app/package.json ./
COPY --from=builder /app/medusa-config.ts ./

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV PORT=9000

EXPOSE 9000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD curl -fsS http://localhost:9000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/entrypoint.sh"]
