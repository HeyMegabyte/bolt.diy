#!/usr/bin/env node
/**
 * backfill_snapshot_metrics.mjs
 *
 * One-shot backfill: hit
 * `POST /api/sites/:siteId/snapshots/:snapshotId/capture`
 * for every existing snapshot in production that's missing metrics.
 *
 * Discovery uses the D1 REST API directly (no worker-side endpoint exposes a
 * full snapshot list cross-org). The capture endpoint itself runs through
 * the live worker so the workflow + cron paths get exercised end-to-end.
 *
 * Usage:
 *   PROJECT_SITES_API_URL=https://projectsites.dev \
 *   PROJECT_SITES_BEARER=sess_xxx \
 *   CLOUDFLARE_API_KEY=cfk_xxx CLOUDFLARE_EMAIL=you@example.com \
 *   node apps/project-sites/scripts/backfill_snapshot_metrics.mjs [--dry-run]
 *
 * Required env:
 *   - PROJECT_SITES_API_URL  base URL of the worker (default: https://projectsites.dev)
 *   - CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL  (D1 REST query auth)
 *   - PROJECT_SITES_BEARER   admin bearer token (org-scoped) for the capture endpoint
 *
 * Flags:
 *   --dry-run    list snapshots that would be re-captured, but skip POST
 *   --limit N    cap snapshots to consider (default 500)
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '84fa0d1b16ff8086dd958c468ce7fd59';
const DATABASE_ID = process.env.D1_DATABASE_ID || 'ea3e839a-c641-4861-ae30-dfc63bff8032';
const API_BASE = process.env.PROJECT_SITES_API_URL || 'https://projectsites.dev';
const BEARER = process.env.PROJECT_SITES_BEARER;
const CF_KEY = process.env.CLOUDFLARE_API_KEY;
const CF_EMAIL = process.env.CLOUDFLARE_EMAIL;
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_FLAG_IDX = process.argv.indexOf('--limit');
const LIMIT = LIMIT_FLAG_IDX >= 0 ? Number(process.argv[LIMIT_FLAG_IDX + 1]) || 500 : 500;

if (!CF_KEY || !CF_EMAIL) {
  console.error('Missing CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL');
  process.exit(1);
}
if (!DRY_RUN && !BEARER) {
  console.error('Missing PROJECT_SITES_BEARER (required unless --dry-run)');
  process.exit(1);
}

async function d1Query(sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        'X-Auth-Email': CF_EMAIL,
        'X-Auth-Key': CF_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql }),
    },
  );
  if (!res.ok) {
    throw new Error(`D1 query failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.result?.[0]?.results ?? [];
}

async function captureSnapshot(siteId, snapshotId) {
  const url = `${API_BASE}/api/sites/${siteId}/snapshots/${snapshotId}/capture`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BEARER}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  return { status: res.status, body: await res.text() };
}

async function main() {
  console.warn(
    `[backfill] discovering snapshots without metrics (limit ${LIMIT}, dry_run=${DRY_RUN})`,
  );
  const rows = await d1Query(`
    SELECT s.id AS snapshot_id, s.site_id, s.snapshot_name, s.build_version, st.slug, st.org_id
      FROM site_snapshots s
      JOIN sites st ON st.id = s.site_id
      LEFT JOIN snapshot_metrics m ON m.snapshot_id = s.id
     WHERE m.id IS NULL
       AND s.deleted_at IS NULL
       AND st.deleted_at IS NULL
     ORDER BY s.created_at DESC
     LIMIT ${Number(LIMIT)}
  `);
  console.warn(`[backfill] ${rows.length} snapshots found needing capture`);

  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    if (DRY_RUN) {
      console.warn(
        `[backfill] would capture ${row.slug}-${row.snapshot_name} (${row.snapshot_id})`,
      );
      continue;
    }
    try {
      const result = await captureSnapshot(row.site_id, row.snapshot_id);
      if (result.status >= 200 && result.status < 300) {
        succeeded += 1;
        console.warn(`[backfill] ok ${row.slug}-${row.snapshot_name} → ${result.status}`);
      } else {
        failed += 1;
        console.warn(
          `[backfill] fail ${row.slug}-${row.snapshot_name} → ${result.status} ${result.body.slice(0, 200)}`,
        );
      }
    } catch (err) {
      failed += 1;
      console.warn(`[backfill] error ${row.snapshot_id}: ${err.message}`);
    }
    // Soft pacing — Browser Rendering quota friendly.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.warn(`[backfill] done: succeeded=${succeeded} failed=${failed} total=${rows.length}`);
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
