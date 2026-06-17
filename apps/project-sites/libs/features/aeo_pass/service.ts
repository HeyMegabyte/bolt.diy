/**
 * @module libs/features/aeo_pass/service
 * @description AEO Pass service — runs Answer Engine Optimization audits
 * against a published site and persists results to D1.
 *
 * @remarks Boundaries are Zod-validated by the handler; this layer assumes
 * validated input and performs D1 reads/writes only. The score and issue
 * list are stubbed at v1 (score 72, three known gaps); a real crawler pass
 * will replace them once the feature graduates to beta.
 */

import type { Env } from '../../../src/types/env.js';
import { dbInsert, dbQueryOne } from '../../../src/services/db.js';
import type { AeoAudit } from './schemas.js';

/** Registry flag key gating this feature. */
export const FLAG_KEY = 'aeo_pass';

/** Stub score and issue list (v1 — replaced at beta with real crawl). */
const STUB_SCORE = 72;
const STUB_ISSUES = [
  'Missing FAQ schema',
  'No quotable answer blocks',
  'Insufficient structured data',
];

/**
 * Run an AEO audit for `siteId` and persist the result.
 *
 * @remarks The audit is intentionally stub-based at v1. The D1 row is
 * inserted via `dbInsert`, which auto-populates `created_at` /
 * `updated_at`, so those columns must NOT be passed in the row object.
 *
 * @returns Typed `AeoAudit` with the freshly-created record.
 */
export async function runAeoAudit(env: Env, siteId: string): Promise<AeoAudit> {
  const id = crypto.randomUUID();

  await dbInsert(env.DB, 'aeo_audits', {
    id,
    site_id: siteId,
    org_id: null,
    score: STUB_SCORE,
    issues: JSON.stringify(STUB_ISSUES),
  });

  return {
    id,
    siteId,
    orgId: null,
    score: STUB_SCORE,
    issues: STUB_ISSUES,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Fetch the most recent AEO audit for `siteId`, or `null` when none exist.
 *
 * @returns `AeoAudit` shaped from the D1 row, or `null`.
 */
export async function getLatestAeoAudit(
  env: Env,
  siteId: string,
): Promise<AeoAudit | null> {
  const row = await dbQueryOne<{
    id: string;
    site_id: string;
    org_id: string | null;
    score: number;
    issues: string;
    created_at: string;
  }>(
    env.DB,
    'SELECT id, site_id, org_id, score, issues, created_at FROM aeo_audits WHERE site_id = ? ORDER BY created_at DESC LIMIT 1',
    [siteId],
  );

  if (!row) return null;

  return {
    id: row.id,
    siteId: row.site_id,
    orgId: row.org_id,
    score: row.score,
    issues: JSON.parse(row.issues) as string[],
    createdAt: row.created_at,
  };
}
