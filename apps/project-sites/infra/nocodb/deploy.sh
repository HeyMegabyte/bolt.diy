#!/usr/bin/env bash
set -euo pipefail
# Deploy NocoDB to CF Workers Containers at db.projectsites.dev
# Stack: CF Containers + Neon Postgres + Upstash Redis + R2 attachments
# AGPL — HTTP boundary isolation per agpl-isolation-via-http-boundary

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP="projectsites-nocodb"
ACCOUNT_ID="84fa0d1b16ff8086dd958c468ce7fd59"
NEON_PROJECT="royal-shape-97525164"
NEON_BRANCH="br-old-leaf-ai01uq85"
NEON_DB="neondb"
R2_BUCKET="projectsites-nocodb-attachments"

echo "=== NocoDB CF Workers Container Deploy ==="

# 1. Get Neon Postgres password
echo "→ Fetching Neon credentials..."
NEON_API_KEY=$(/Users/Apple/.local/bin/get-secret NEON_API_KEY)
NEON_PASSWORD=$(curl -sS \
  "https://console.neon.tech/api/v2/projects/${NEON_PROJECT}/connection_uri?database=${NEON_DB}&role_name=neondb_owner&branch_id=${NEON_BRANCH}" \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  | python3 -c "import sys,json,urllib.parse; u=json.load(sys.stdin)['uri']; p=urllib.parse.urlparse(u); print(urllib.parse.unquote(p.password))")

# 2. Set secrets (values never printed)
echo "→ Setting wrangler secrets..."
printf '%s' "${NEON_PASSWORD}" | wrangler secret put NC_DB_PASSWORD --env production 2>&1 | tail -1

JWT=$(openssl rand -base64 32)
printf '%s' "${JWT}" | wrangler secret put NC_AUTH_JWT_SECRET --env production 2>&1 | tail -1

# 3. Create R2 bucket (idempotent)
echo "→ Ensuring R2 bucket ${R2_BUCKET}..."
wrangler r2 bucket create "${R2_BUCKET}" 2>&1 || echo "  (bucket may already exist)"

# 4. Deploy
echo "→ Deploying to CF Workers Containers..."
cd "${SCRIPT_DIR}"
wrangler deploy --env production

echo ""
echo "=== Deploy complete ==="
echo "Worker: https://${APP}.projectsites.workers.dev"
echo ""
echo "Next steps:"
echo "  1. Set NC_CACHE_REDIS_URL secret (Upstash Redis):"
echo "     wrangler secret put NC_CACHE_REDIS_URL --env production"
echo ""
echo "  2. Create R2 API tokens for S3-compatible access:"
echo "     https://dash.cloudflare.com/${ACCOUNT_ID}/r2/api-tokens"
echo "     Then:"
echo "     wrangler secret put NC_S3_ACCESS_KEY --env production"
echo "     wrangler secret put NC_S3_ACCESS_SECRET --env production"
echo ""
echo "  3. Add CNAME db.projectsites.dev → ${APP}.projectsites.workers.dev (proxied)"
echo ""
echo "  4. Verify: curl -sI https://db.projectsites.dev/api/v1/health"
