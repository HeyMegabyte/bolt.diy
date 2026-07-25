# Lago — open-source billing for usage-based pricing.
# Deployed as a CF Workers Container at lago.projectsites.dev.
# Uses the official Lago API image; frontend served separately.
# Lago does not publish a public Docker image. It runs on Fly.io (projectsites-lago).
# The CF Container config is preserved for future use when Lago publishes an image.
# For now, Lago is hosted at billing.projectsites.dev via Fly.io.
# FROM ??? — no public Docker image available

# Lago API listens on 3000
EXPOSE 3000

# Config injected via wrangler secrets (env vars)
# Required: DATABASE_URL, SECRET_KEY_BASE, REDIS_URL
# Optional: LAGO_FRONT_URL, LAGO_CLICKHOUSE_URL, etc.
