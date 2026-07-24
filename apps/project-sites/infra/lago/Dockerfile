# Lago — open-source billing for usage-based pricing.
# Deployed as a CF Workers Container at lago.projectsites.dev.
# Uses the official Lago API image; frontend served separately.
FROM ghcr.io/getlago/lago-api:latest

# Lago API listens on 3000
EXPOSE 3000

# Config injected via wrangler secrets (env vars)
# Required: DATABASE_URL, SECRET_KEY_BASE, REDIS_URL
# Optional: LAGO_FRONT_URL, LAGO_CLICKHOUSE_URL, etc.
