# syntax=docker/dockerfile:1
# =============================================================================
# projectsites-voice — multi-stage build, non-root runtime
# =============================================================================

# --- deps stage: install production node_modules only ---
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# --- runtime stage: minimal, non-root ---
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy only what the server needs.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./

# Run as the built-in unprivileged `node` user.
USER node

EXPOSE 8080
CMD ["node", "server.js"]
