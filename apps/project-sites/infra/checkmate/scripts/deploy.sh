#!/usr/bin/env bash
# Deploy Checkmate to Fly.io + configure Cloudflare DNS for monitor.projectsites.dev
# Run: bash apps/project-sites/infra/checkmate/scripts/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKMATE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git -C "$CHECKMATE_DIR" rev-parse --show-toplevel)"
APP="projectsites-checkmate"
DOMAIN="monitor.projectsites.dev"
ZONE_ID="9ceaa211750dd31899fd5fd1bf8d1ec46"  # projectsites.dev
ACCOUNT_ID="84fa0d1b16ff8086dd958c468ce7fd59"

echo "=== Deploying Checkmate to $DOMAIN ==="

# --- Auth ---
export CLOUDFLARE_API_KEY
CLOUDFLARE_API_KEY="$(/Users/Apple/.local/bin/get-secret CLOUDFLARE_API_KEY)"
export CLOUDFLARE_EMAIL="blzalewski@gmail.com"

# --- Check prerequisites ---
command -v flyctl >/dev/null 2>&1 || { echo "ERROR: flyctl not found. Install: brew install flyctl"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl not found."; exit 1; }

cd "$CHECKMATE_DIR"

# --- Generate JWT_SECRET if not already set ---
if ! flyctl secrets list --app "$APP" 2>/dev/null | grep -q JWT_SECRET; then
  echo "→ Generating JWT_SECRET..."
  JWT_SECRET="$(openssl rand -hex 64)"
  echo -n "$JWT_SECRET" | flyctl secrets set JWT_SECRET=- --app "$APP"
  echo "  JWT_SECRET set."
fi

# --- Deploy to Fly.io ---
echo "→ Creating/updating Fly.io app: $APP"
if ! flyctl apps list 2>/dev/null | grep -q "$APP"; then
  flyctl apps create "$APP"
  echo "  App created."
fi

# --- Create persistent volume for MongoDB (one-time) ---
if ! flyctl volumes list --app "$APP" 2>/dev/null | grep -q checkmate_mongo_data; then
  echo "→ Creating persistent volume: checkmate_mongo_data (1 GB)"
  flyctl volumes create checkmate_mongo_data \
    --app "$APP" \
    --region iad \
    --size 1 \
    --yes
  echo "  Volume created."
fi

echo "→ Deploying (flyctl deploy)..."
flyctl deploy --app "$APP"

# --- Allocate IP if needed ---
if ! flyctl ips list --app "$APP" 2>/dev/null | grep -q "v4"; then
  echo "→ Allocating IPv4..."
  flyctl ips allocate-v4 --app "$APP" --shared
fi

FLY_IP="$(flyctl ips list --app "$APP" 2>/dev/null | grep 'v4' | awk '{print $2}')"
echo "  Fly IP: $FLY_IP"

# --- Configure Cloudflare DNS ---
echo "→ Configuring Cloudflare DNS for $DOMAIN..."

# Check existing DNS record
EXISTING="$(curl -s \
  -H "X-Auth-Email: $CLOUDFLARE_EMAIL" \
  -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=A&name=$DOMAIN" \
  | jq -r '.result[0].id // empty')"

if [ -n "$EXISTING" ]; then
  echo "→ Updating existing DNS record ($EXISTING)..."
  curl -s \
    -H "X-Auth-Email: $CLOUDFLARE_EMAIL" \
    -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
    -H "Content-Type: application/json" \
    -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$EXISTING" \
    -d "{\"type\":\"A\",\"name\":\"monitor\",\"content\":\"$FLY_IP\",\"ttl\":1,\"proxied\":true}" \
    | jq '.success'
else
  echo "→ Creating DNS record..."
  curl -s \
    -H "X-Auth-Email: $CLOUDFLARE_EMAIL" \
    -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
    -H "Content-Type: application/json" \
    -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
    -d "{\"type\":\"A\",\"name\":\"monitor\",\"content\":\"$FLY_IP\",\"ttl\":1,\"proxied\":true}" \
    | jq '.success'
fi

echo ""
echo "=== Deploy complete ==="
echo ""
echo "URL: https://$DOMAIN"
echo "Wait ~2 min for Cloudflare DNS + Fly certificate propagation."
echo ""
echo "Next steps:"
echo "1. Run smoke test: CHECKMATE_URL=https://$DOMAIN bash scripts/smoke.sh"
echo "2. Open https://$DOMAIN → create admin account"
echo "3. Disable public registration after admin is created:"
echo "   flyctl secrets set DISABLE_REGISTRATION=true --app $APP"
echo "4. Seed ProjectSites endpoint pack: see README.md § Monitors"
