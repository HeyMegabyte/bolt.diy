#!/usr/bin/env bash
set -euo pipefail
# Add CNAME db.projectsites.dev → projectsites-nocodb.fly.dev
# Zone: 9ceaa211750dd31899fd5d1bf8d1ec46

ZONE="9ceaa211750dd31899fd5d1bf8d1ec46"
NAME="db.projectsites.dev"
TARGET="projectsites-nocodb.fly.dev"

CF_KEY=$(/Users/Apple/.local/bin/get-secret CLOUDFLARE_API_KEY)
CF_EMAIL="blzalewski@gmail.com"
AUTH_HEADER="X-Auth-Email: ${CF_EMAIL}"

# Check existing
EXISTING=$(curl -sS \
  -H "${AUTH_HEADER}" \
  -H "X-Auth-Key: ${CF_KEY}" \
  "https://api.cloudflare.com/client/v4/zones/${ZONE}/dns_records?type=CNAME&name=${NAME}")

COUNT=$(echo "${EXISTING}" | python3 -c "import sys,json; print(json.load(sys.stdin)['result_info']['count'])")

if [ "${COUNT}" -gt 0 ]; then
  echo "Record already exists:"
  echo "${EXISTING}" | python3 -c "import sys,json; [print(f\"  {r['name']} → {r['content']}\") for r in json.load(sys.stdin)['result']]"
  exit 0
fi

# Create
echo "→ Creating CNAME ${NAME} → ${TARGET}..."
curl -sS \
  -H "${AUTH_HEADER}" \
  -H "X-Auth-Key: ${CF_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"CNAME\",\"name\":\"${NAME}\",\"content\":\"${TARGET}\",\"ttl\":1,\"proxied\":false}" \
  "https://api.cloudflare.com/client/v4/zones/${ZONE}/dns_records" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print('OK' if r['success'] else 'FAIL: '+str(r['errors']))"

echo ""
echo "Verify: dig +short ${NAME}"
