#!/usr/bin/env bash
# Upload sample site and marketing homepage to R2.
#
# Usage:
#   ./scripts/upload_to_r2.sh [--env staging|production]
#
# Prerequisites:
#   - wrangler authenticated (CLOUDFLARE_API_TOKEN or `wrangler login`)
#   - R2 bucket created (project-sites / project-sites-staging / project-sites-production)

set -euo pipefail

ENV="${1:---env staging}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUCKET_BINDING="SITES_BUCKET"
DEMO_SLUG="bella-cucina"
DEMO_VERSION="v1"

echo "=== Project Sites R2 Upload ==="
echo "Environment: $ENV"
echo ""

# ─── Upload marketing homepage ───────────────────────────
echo "▸ Uploading marketing homepage..."
npx wrangler r2 object put "$BUCKET_BINDING/marketing/index.html" \
  --file "$PROJECT_DIR/public/index.html" \
  --content-type "text/html" \
  $ENV

echo "  ✓ marketing/index.html uploaded"

# ─── Upload demo site ────────────────────────────────────
echo ""
echo "▸ Uploading demo site: $DEMO_SLUG..."
npx wrangler r2 object put "$BUCKET_BINDING/sites/$DEMO_SLUG/$DEMO_VERSION/index.html" \
  --file "$PROJECT_DIR/samples/demo-site/index.html" \
  --content-type "text/html" \
  $ENV

echo "  ✓ sites/$DEMO_SLUG/$DEMO_VERSION/index.html uploaded"

# ─── Summary ─────────────────────────────────────────────
echo ""
echo "=== Upload Complete ==="
echo ""
echo "Marketing homepage:"
echo "  https://sites.megabyte.space/"
echo ""
echo "Demo site (requires DB record with slug=$DEMO_SLUG, current_build_version=$DEMO_VERSION):"
echo "  https://$DEMO_SLUG.sites.megabyte.space/"
echo ""
echo "To create the DB record, run:"
echo "  INSERT INTO sites (id, org_id, slug, status, current_build_version)"
echo "  VALUES (gen_random_uuid(), '<your-org-id>', '$DEMO_SLUG', 'published', '$DEMO_VERSION');"
