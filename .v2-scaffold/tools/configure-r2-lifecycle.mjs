#!/usr/bin/env node
/**
 * configure-r2-lifecycle.mjs
 *
 * Apply the canonical R2 lifecycle policy to `project-sites-production`:
 *
 *   Standard → Infrequent Access after 30 days of inactivity.
 *
 * This rule applies to every object in the bucket. R2 IA storage runs ~70% cheaper
 * than Standard but has a $0.01/GB retrieval fee — break-even at <14 reads/month/GB,
 * which our snapshots + marketing assets + old uploads clear by a wide margin.
 *
 * USAGE
 *   CLOUDFLARE_API_TOKEN=... \
 *   CLOUDFLARE_ACCOUNT_ID=... \
 *   node tools/configure-r2-lifecycle.mjs            # dry-run, prints the PUT body
 *   node tools/configure-r2-lifecycle.mjs --apply    # actually call the API
 *
 * SCOPED TOKEN PERMISSIONS
 *   `Workers R2 Storage:Edit` (permission group `bf7481a1826f439697cb59a20b22293e`)
 *
 * @see https://developers.cloudflare.com/api/operations/r2-put-bucket-lifecycle-configuration
 * @see https://developers.cloudflare.com/r2/buckets/object-lifecycles/
 */

const BUCKET_NAME = 'project-sites-production';

/**
 * Canonical lifecycle policy — committed alongside the script so reviewers can
 * see the exact JSON the API will receive without running the tool.
 */
export const LIFECYCLE_RULES = {
  rules: [
    {
      id: 'standard-to-ia-30d',
      enabled: true,
      conditions: {
        // Apply to every key in the bucket. Narrow via `prefix` if/when we
        // want different policies for `sites/` vs `marketing/` vs `snapshots/`.
        prefix: '',
      },
      // 30-day transition. R2 measures days from object creation.
      storageClassTransitions: [
        {
          condition: { type: 'Age', maxAge: 30 * 24 * 60 * 60 },
          storageClass: 'InfrequentAccess',
        },
      ],
    },
  ],
};

async function main() {
  const apply = process.argv.includes('--apply');
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!apply) {
    console.log('[dry-run] would PUT the following body to:');
    console.log(
      `  https://api.cloudflare.com/client/v4/accounts/${accountId ?? '{ACCOUNT_ID}'}/r2/buckets/${BUCKET_NAME}/lifecycle`,
    );
    console.log(JSON.stringify(LIFECYCLE_RULES, null, 2));
    console.log('\nRun with --apply to send the request.');
    return;
  }

  if (!accountId || !apiToken) {
    console.error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN.');
    process.exit(1);
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET_NAME}/lifecycle`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(LIFECYCLE_RULES),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    console.error('R2 lifecycle PUT failed:', JSON.stringify(json, null, 2));
    process.exit(1);
  }
  console.log('R2 lifecycle policy applied to', BUCKET_NAME);
  console.log(JSON.stringify(json.result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
