#!/usr/bin/env bash
# Deploy OpenHands Agent Canvas — Fly.io origin + Cloudflare Worker
# Run: bash apps/project-sites/infra/openhands/deploy.sh
set -euo pipefail

echo "=== Deploying OpenHands Agent Canvas ==="

cd "$(git rev-parse --show-toplevel)"

# ── Auth ─────────────────────────────────────────────────────────────────────
export CLOUDFLARE_API_KEY
CLOUDFLARE_API_KEY="$(/Users/Apple/.local/bin/get-secret CLOUDFLARE_API_KEY)"
export CLOUDFLARE_EMAIL="blzalewski@gmail.com"

# ── Generate secrets ─────────────────────────────────────────────────────────
echo "→ Generating secrets..."

ORIGIN_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"

echo "   OPENHANDS_ORIGIN_SECRET = (generated)"
echo "   OPENHANDS_SESSION_SECRET = (generated)"
echo "   OPENHANDS_ADMIN_PASSWORD = (generated)"

# ── Create KV namespace ──────────────────────────────────────────────────────
echo "→ Creating KV namespace for sessions..."
KV_OUTPUT=$(npx wrangler kv namespace create OPENHANDS_SESSIONS 2>&1 || true)
echo "$KV_OUTPUT"

KV_ID=$(echo "$KV_OUTPUT" | grep -oE '"id"[[:space:]]*:[[:space:]]*"[a-f0-9]+"' | head -1 | grep -oE '[a-f0-9]{32,}' || true)

if [ -z "$KV_ID" ]; then
  echo "→ KV namespace may already exist, listing..."
  KV_ID=$(npx wrangler kv namespace list 2>&1 | grep -A1 OPENHANDS_SESSIONS | grep -oE '[a-f0-9]{32,}' || true)
fi

if [ -n "$KV_ID" ]; then
  echo "   KV namespace ID: $KV_ID"
  # Update wrangler.toml with the actual KV ID
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/id = \"OPENHANDS_SESSIONS_KV\"/id = \"$KV_ID\"/g" apps/project-sites/infra/openhands/wrangler.toml
  else
    sed -i "s/id = \"OPENHANDS_SESSIONS_KV\"/id = \"$KV_ID\"/g" apps/project-sites/infra/openhands/wrangler.toml
  fi
fi

# ── Set Worker secrets ───────────────────────────────────────────────────────
cd apps/project-sites/infra/openhands

echo "→ Setting Worker secrets..."
printf '%s' "$ADMIN_PASSWORD" | npx wrangler secret put OPENHANDS_ADMIN_PASSWORD 2>&1
printf '%s' "$SESSION_SECRET" | npx wrangler secret put OPENHANDS_SESSION_SECRET 2>&1
printf '%s' "$ORIGIN_SECRET" | npx wrangler secret put OPENHANDS_ORIGIN_SECRET 2>&1

# ── Deploy Fly.io origin ─────────────────────────────────────────────────────
echo "→ Deploying Fly.io origin..."

# Check if app exists
if flyctl apps list 2>/dev/null | grep -q projectsites-openhands; then
  echo "   App exists, checking volume..."
  # Create volume if it doesn't exist
  flyctl volumes list --app projectsites-openhands 2>&1 | grep -q openhands_data || {
    echo "   Creating persistent volume..."
    flyctl volumes create openhands_data \
      --app projectsites-openhands \
      --region iad \
      --size 10 \
      --no-encryption 2>&1 || echo "   Volume may already exist or need manual creation"
  }
else
  echo "   Creating Fly.io app..."
  flyctl apps create projectsites-openhands --org personal 2>&1
  echo "   Creating persistent volume..."
  flyctl volumes create openhands_data \
    --app projectsites-openhands \
    --region iad \
    --size 10 \
    --no-encryption 2>&1
fi

# Set origin secret on Fly.io
printf '%s' "$ORIGIN_SECRET" | flyctl secrets set OPENHANDS_ORIGIN_SECRET="$(cat)" \
  --app projectsites-openhands 2>&1 || echo "   (secret may already be set)"

# Deploy
echo "→ Deploying Fly.io app..."
flyctl deploy --app projectsites-openhands --ha=false 2>&1

# ── Deploy Worker ────────────────────────────────────────────────────────────
echo "→ Deploying Cloudflare Worker..."
npx wrangler deploy 2>&1

# ── Print results ────────────────────────────────────────────────────────────
echo ""
echo "=== Deploy complete ==="
echo ""
echo "URL: https://openhands.projectsites.dev"
echo ""
echo "Admin password (save this — it won't be shown again):"
echo "  $ADMIN_PASSWORD"
echo ""
echo "To update Fly.io origin URL in Worker if needed:"
echo "  cd apps/project-sites/infra/openhands"
echo "  npx wrangler secret put OPENHANDS_ORIGIN_URL"
echo ""
echo "Verify:"
echo "  curl -sS -D - https://openhands.projectsites.dev/ -o /dev/null | head -20"
