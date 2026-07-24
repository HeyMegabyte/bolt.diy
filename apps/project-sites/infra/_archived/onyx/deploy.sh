#!/usr/bin/env bash
# =============================================================================
# deploy-onyx.sh — Deploy Onyx to Fly.io at onyx.projectsites.dev
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="onyx-projectsites"

echo "=== Deploying Onyx to Fly.io ==="

# ── 1. Check prerequisites ────────────────────────────────────────────────
command -v flyctl >/dev/null 2>&1 || { echo "ERR: flyctl not found. Install: curl -L https://fly.io/install.sh | sh"; exit 1; }

# ── 2. Check logged in ────────────────────────────────────────────────────
if ! flyctl auth whoami >/dev/null 2>&1; then
  echo "→ Run: flyctl auth login"
  exit 1
fi

# ── 3. Create app if not exists ───────────────────────────────────────────
if ! flyctl apps list | grep -q "$APP_NAME"; then
  echo "→ Creating Fly app: $APP_NAME"
  flyctl apps create "$APP_NAME" --org megabyte-labs
fi

# ── 4. Set secrets (non-committed values) ─────────────────────────────────
echo "→ Setting secrets..."

# Generate USER_AUTH_SECRET if not already set
if ! flyctl secrets list -a "$APP_NAME" 2>/dev/null | grep -q "USER_AUTH_SECRET"; then
  USER_AUTH_SECRET="$(openssl rand -hex 32)"
  flyctl secrets set -a "$APP_NAME" "USER_AUTH_SECRET=$USER_AUTH_SECRET"
  echo "  USER_AUTH_SECRET generated and set"
fi

# These must be pre-set. Source them from the environment or get-secret.
REQUIRED_SECRETS=(
  POSTGRES_PASSWORD
  REDIS_HOST
  REDIS_PASSWORD
)

for secret in "${REQUIRED_SECRETS[@]}"; do
  if flyctl secrets list -a "$APP_NAME" 2>/dev/null | grep -q "$secret"; then
    echo "  $secret already set"
  else
    value="${!secret:-}"
    if [ -z "$value" ]; then
      echo "  ⚠ $secret not in env — getting from get-secret"
      value="$(get-secret "$secret" 2>/dev/null || true)"
    fi
    if [ -n "$value" ]; then
      flyctl secrets set -a "$APP_NAME" "$secret=$value"
      echo "  $secret set"
    else
      echo "  ERR: $secret is required but not available"
      echo "  Set via: flyctl secrets set -a $APP_NAME $secret=<value>"
      missing_secrets=true
    fi
  fi
done

if [ "${missing_secrets:-false}" = "true" ]; then
  echo ""
  echo "⚠ Missing secrets listed above. Set them then re-run this script."
  exit 1
fi

# Optional: set GEN_AI_API_KEY for AI features
if ! flyctl secrets list -a "$APP_NAME" 2>/dev/null | grep -q "GEN_AI_API_KEY"; then
  if [ -n "${GEN_AI_API_KEY:-}" ]; then
    flyctl secrets set -a "$APP_NAME" "GEN_AI_API_KEY=$GEN_AI_API_KEY"
    echo "  GEN_AI_API_KEY set"
  else
    echo "  ℹ GEN_AI_API_KEY not set — AI features won't work (login still works)"
  fi
fi

# ── 5. Deploy ─────────────────────────────────────────────────────────────
echo "→ Deploying..."
cd "$SCRIPT_DIR"
flyctl deploy -a "$APP_NAME"

# ── 6. Verify ─────────────────────────────────────────────────────────────
echo ""
echo "→ Deploy complete. Checking health..."
sleep 5

APP_URL="https://onyx.projectsites.dev"
HTTP_CODE=$(curl -L -s -o /dev/null -w "%{http_code}" "$APP_URL" 2>&1 || echo "000")
echo "  $APP_URL → HTTP $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Onyx is LIVE at $APP_URL"
else
  echo "⚠ Got HTTP $HTTP_CODE — checking in 10s..."
  sleep 10
  HTTP_CODE=$(curl -L -s -o /dev/null -w "%{http_code}" "$APP_URL" 2>&1 || echo "000")
  echo "  Retry: $APP_URL → HTTP $HTTP_CODE"
fi

# ── 7. Print info ─────────────────────────────────────────────────────────
echo ""
echo "=== Onyx Deploy Summary ==="
echo "  URL:  $APP_URL"
echo "  App:  $APP_NAME"
echo "  Logs: flyctl logs -a $APP_NAME"
echo "  SSH:  flyctl ssh console -a $APP_NAME"
