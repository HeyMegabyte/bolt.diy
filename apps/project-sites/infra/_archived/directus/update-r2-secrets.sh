#!/usr/bin/env bash
# Update R2 S3 credentials for Directus
# Run this AFTER creating R2 API token at:
# https://dash.cloudflare.com/84fa0d1b16ff8086dd958c468ce7fd59/r2/api-tokens
#
# Steps:
# 1. Open the URL above in browser
# 2. Click "Create API Token"
# 3. Set permissions: Object Read & Write
# 4. Scope to bucket: projectsites-directus-assets
# 5. Copy the Access Key ID and Secret Access Key
# 6. Run this script with the credentials
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <R2_ACCESS_KEY_ID> <R2_SECRET_ACCESS_KEY>"
  echo ""
  echo "Get these from: https://dash.cloudflare.com/84fa0d1b16ff8086dd958c468ce7fd59/r2/api-tokens"
  exit 1
fi

R2_KEY="$1"
R2_SECRET="$2"

cd "$(dirname "$0")"

export CLOUDFLARE_API_KEY=$(/Users/Apple/.local/bin/get-secret CLOUDFLARE_API_KEY)
export CLOUDFLARE_EMAIL="blzalewski@gmail.com"

echo "Updating R2 secrets..."
echo "$R2_KEY" | npx wrangler secret put STORAGE_R2_KEY
echo "$R2_SECRET" | npx wrangler secret put STORAGE_R2_SECRET

echo ""
echo "Redeploying..."
export WRANGLER_DOCKER_BIN=/usr/local/bin/docker
npx wrangler deploy

echo ""
echo "Done! Verify uploads persist:"
echo "1. Log into https://directus.projectsites.dev"
echo "2. Upload a test file"
echo "3. Run this script again (redeploys)"
echo "4. Verify the file still exists"
