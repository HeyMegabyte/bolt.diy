/**
 * Usage Gauges service — per-org usage metrics from D1.
 *
 * Computes site count, build count, estimated media storage, and bandwidth
 * against plan limits. Designed to feed SVG gauge-ring components in the
 * admin dashboard.
 *
 * @module libs/features/usage_gauges/service
 */
import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbQueryOne } from '../../../src/services/db.js';
import type { UsageGauge } from './schemas.js';

/** Default free-tier limits. */
const FREE_LIMITS = {
  sites: 3,
  builds: 10,
  media_gb: 1,
  bandwidth_gb: 5,
};

interface CountRow {
  cnt: number;
}

interface SizeRow {
  total_mb: number;
}

/**
 * Compute usage gauges for an org. Queries D1 for live counts and
 * compares against free-tier limits (paid plan limits TBD).
 */
export async function computeUsageGauges(env: Env, orgId: string): Promise<UsageGauge[]> {
  const [siteRow] = await Promise.all([
    dbQueryOne<CountRow>(
      env.DB,
      `SELECT COUNT(*) as cnt FROM sites WHERE org_id = ? AND deleted_at IS NULL`,
      [orgId],
    ),
  ]);

  const buildRow = await dbQueryOne<CountRow>(
    env.DB,
    `SELECT COUNT(*) as cnt FROM workflow_jobs
     WHERE org_id = ? AND job_name = 'build' AND deleted_at IS NULL`,
    [orgId],
  );

  const mediaRow = await dbQueryOne<SizeRow>(
    env.DB,
    // Media storage lives in `media_assets.size_bytes` (per-org), NOT on `sites` —
    // the old `SUM(media_size_bytes) FROM sites` referenced a column that doesn't
    // exist, so the query threw (swallowed by dbQuery) and the Media gauge always
    // read 0 GB regardless of actual usage.
    `SELECT COALESCE(SUM(size_bytes), 0) / 1048576.0 as total_mb
     FROM media_assets WHERE org_id = ? AND deleted_at IS NULL`,
    [orgId],
  );

  const sites = Number(siteRow?.cnt ?? 0);
  const builds = Number(buildRow?.cnt ?? 0);
  const mediaGb = Number(((mediaRow?.total_mb ?? 0) / 1024).toFixed(2));

  const gauges: UsageGauge[] = [
    {
      metric: 'sites',
      label: 'Sites',
      used: sites,
      limit: FREE_LIMITS.sites,
      unit: 'sites',
      pct: Math.min(100, Math.round((sites / FREE_LIMITS.sites) * 100)),
    },
    {
      metric: 'builds',
      label: 'Builds',
      used: builds,
      limit: FREE_LIMITS.builds,
      unit: 'builds',
      pct: Math.min(100, Math.round((builds / FREE_LIMITS.builds) * 100)),
    },
    {
      metric: 'media_gb',
      label: 'Media',
      used: mediaGb,
      limit: FREE_LIMITS.media_gb,
      unit: 'GB',
      pct: Math.min(100, Math.round((mediaGb / FREE_LIMITS.media_gb) * 100)),
    },
    {
      metric: 'bandwidth_gb',
      label: 'Bandwidth',
      used: 0,
      limit: FREE_LIMITS.bandwidth_gb,
      unit: 'GB',
      pct: 0,
    },
  ];

  return gauges;
}
