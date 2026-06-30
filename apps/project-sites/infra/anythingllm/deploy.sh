#!/usr/bin/env bash
# Deploy AnythingLLM to CF Workers Container + set up anything.projectsites.dev
# Run: bash apps/project-sites/infra/anythingllm/deploy.sh
set -euo pipefail

echo "=== Deploying AnythingLLM to anything.projectsites.dev ==="

cd "$(git rev-parse --show-toplevel)"

# Auth
export CLOUDFLARE_API_KEY
CLOUDFLARE_API_KEY="$(/Users/Apple/.local/bin/get-secret CLOUDFLARE_API_KEY)"
export CLOUDFLARE_EMAIL="blzalewski@gmail.com"
export WRANGLER_DOCKER_BIN=/usr/local/bin/docker

cd apps/project-sites/infra/anythingllm

echo "→ Setting wrangler secrets..."
# Generated fresh on first deploy; re-read from get-secret on subsequent deploys.
JWT_SECRET="$(/Users/Apple/.local/bin/get-secret ANYTHINGLLM_JWT_SECRET 2>/dev/null || openssl rand -base64 48)"
SIG_KEY="$(/Users/Apple/.local/bin/get-secret ANYTHINGLLM_SIG_KEY 2>/dev/null || openssl rand -base64 48)"
SIG_SALT="$(/Users/Apple/.local/bin/get-secret ANYTHINGLLM_SIG_SALT 2>/dev/null || openssl rand -base64 48)"
AUTH_TOKEN="$(/Users/Apple/.local/bin/get-secret ANYTHINGLLM_AUTH_TOKEN 2>/dev/null || openssl rand -base64 24)"
PGVECTOR_CONNECTION_STRING="$(/Users/Apple/.local/bin/get-secret ANYTHINGLLM_PGVECTOR_CONNECTION_STRING)"

# Secret names match env vars in worker.ts (no prefix)
echo "$JWT_SECRET" | npx wrangler secret put JWT_SECRET
echo "$SIG_KEY" | npx wrangler secret put SIG_KEY
echo "$SIG_SALT" | npx wrangler secret put SIG_SALT
echo "$AUTH_TOKEN" | npx wrangler secret put AUTH_TOKEN
echo "$PGVECTOR_CONNECTION_STRING" | npx wrangler secret put PGVECTOR_CONNECTION_STRING

echo "→ Deploying CF Container..."
npx wrangler deploy

echo ""
echo "=== Deploy complete ==="
echo ""
echo "Next steps:"
echo "1. Wait ~2-3 min for container cold start"
echo "2. Open https://anything.projectsites.dev"
echo "3. Create admin account (first user is auto-admin)"
echo "4. Smoke test: bash scripts/smoke/anythingllm.sh"
echo ""
echo "AUTH_TOKEN (for API access): ${AUTH_TOKEN:0:8}..."
echo "Save it: get-secret ANYTHINGLLM_AUTH_TOKEN"
