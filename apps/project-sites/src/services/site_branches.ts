/**
 * @module services/site_branches
 * @description Branch-style site previews (#27).
 *
 * Each branch gets a preview URL `{branch}--{slug}.projectsites.dev`.
 * The naming convention uses `--` as the separator so the host resolver
 * can distinguish branch prefixes from snapshot names (which use `-`).
 *
 * Branch lifecycle: draft → review → merged | closed
 *
 * @packageDocumentation
 */

import type { D1Database } from '@cloudflare/workers-types';
import { dbInsert, dbUpdate, dbQueryOne, dbQuery } from './db.js';

// ─── types ────────────────────────────────────────────────────────────────────

export interface SiteBranch {
  id: string;
  site_id: string;
  branch_name: string;
  created_by: string;
  status: 'draft' | 'review' | 'merged' | 'closed';
  r2_path: string | null;
  preview_url: string | null;
  approvals_required: number;
  approvals_received: number;
  created_at: string;
  updated_at: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Sanitise branch names so they are safe in a hostname label.
 * Strips leading/trailing hyphens and replaces invalid chars with `-`.
 * Max 32 chars to keep the preview hostname under 63 chars.
 */
function sanitiseBranchName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    || 'branch';
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Create a new branch for `siteId`.
 * The R2 path and preview URL are recorded immediately; the caller is
 * responsible for uploading files to R2 and triggering notifications.
 *
 * @param db       - D1 database
 * @param siteId   - owning site id
 * @param userId   - user creating the branch
 * @param opts     - branch options
 * @returns        - the newly created `SiteBranch`
 *
 * @example
 * ```ts
 * const branch = await createBranch(env.DB, siteId, userId, { branchName: 'feat-new-hero', slug: 'vitos-salon' });
 * ```
 */
export async function createBranch(
  db: D1Database,
  siteId: string,
  userId: string,
  opts: {
    branchName: string;
    slug: string;
    approvalsRequired?: number;
  },
): Promise<SiteBranch> {
  const name = sanitiseBranchName(opts.branchName);
  const id = crypto.randomUUID();
  const r2Path = `sites/${opts.slug}/branches/${name}/`;
  const previewUrl = `https://${name}--${opts.slug}.projectsites.dev`;

  await dbInsert(db, 'site_branches', {
    id,
    site_id: siteId,
    branch_name: name,
    created_by: userId,
    status: 'draft',
    r2_path: r2Path,
    preview_url: previewUrl,
    approvals_required: opts.approvalsRequired ?? 1,
    approvals_received: 0,
  });

  return (await dbQueryOne<SiteBranch>(
    db,
    'SELECT * FROM site_branches WHERE id = ?',
    [id],
  ))!;
}

/**
 * Transition a branch to `review` status and optionally fire a Slack notification.
 * No-op if the branch is already in review or beyond.
 */
export async function requestReview(
  db: D1Database,
  branchId: string,
  slackWebhookUrl?: string,
): Promise<SiteBranch | null> {
  const branch = await dbQueryOne<SiteBranch>(
    db,
    'SELECT * FROM site_branches WHERE id = ? AND deleted_at IS NULL',
    [branchId],
  );
  if (!branch || branch.status !== 'draft') return null;

  await dbUpdate(db, 'site_branches', { status: 'review' }, 'id = ?', [branchId]);

  // Fire Slack notification — no-op when webhook not configured.
  if (slackWebhookUrl) {
    try {
      await fetch(slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🔀 Branch review requested`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Branch \`${branch.branch_name}\` is ready for review.*\nPreview: <${branch.preview_url}|${branch.preview_url}>`,
              },
            },
          ],
        }),
      });
    } catch {
      // Notification failures must never break the workflow.
      console.warn(JSON.stringify({ level: 'warn', service: 'site_branches', event: 'slack_notify_failed', branch_id: branchId }));
    }
  }

  return dbQueryOne<SiteBranch>(db, 'SELECT * FROM site_branches WHERE id = ?', [branchId]);
}

/**
 * Record an approval for a branch.
 * When `approvals_received` reaches `approvals_required` the status
 * stays `review`; the merge step is explicit (separate action).
 */
export async function approveBranch(
  db: D1Database,
  branchId: string,
  approverId: string,
): Promise<{ branch: SiteBranch; readyToMerge: boolean } | null> {
  const branch = await dbQueryOne<SiteBranch>(
    db,
    'SELECT * FROM site_branches WHERE id = ? AND deleted_at IS NULL',
    [branchId],
  );
  if (!branch || branch.status !== 'review') return null;

  // Idempotent: skip if this approver already approved.
  const existing = await dbQueryOne(
    db,
    'SELECT id FROM site_branch_approvals WHERE branch_id = ? AND approver_id = ?',
    [branchId, approverId],
  );
  if (!existing) {
    await dbInsert(db, 'site_branch_approvals', {
      id: crypto.randomUUID(),
      branch_id: branchId,
      approver_id: approverId,
    });
    await db
      .prepare(
        'UPDATE site_branches SET approvals_received = approvals_received + 1, updated_at = datetime(\'now\') WHERE id = ?',
      )
      .bind(branchId)
      .run();
  }

  const updated = await dbQueryOne<SiteBranch>(
    db,
    'SELECT * FROM site_branches WHERE id = ?',
    [branchId],
  );
  return updated
    ? { branch: updated, readyToMerge: updated.approvals_received >= updated.approvals_required }
    : null;
}

/**
 * Merge a branch: copy files from the branch R2 path to the canonical site
 * path and update the site's `current_build_version`.
 *
 * This function only updates D1 status — actual R2 file copying must be done
 * by the caller (Worker route) using `env.SITES_BUCKET.list` + `put`.
 */
export async function mergeBranch(
  db: D1Database,
  branchId: string,
  newBuildVersion: string,
): Promise<SiteBranch | null> {
  const branch = await dbQueryOne<SiteBranch>(
    db,
    'SELECT * FROM site_branches WHERE id = ? AND deleted_at IS NULL',
    [branchId],
  );
  if (!branch || (branch.status !== 'review' && branch.status !== 'draft')) return null;

  await dbUpdate(db, 'site_branches', { status: 'merged' }, 'id = ?', [branchId]);

  // Bump the site's build version to the merged content.
  await dbUpdate(
    db,
    'sites',
    { current_build_version: newBuildVersion },
    'id = ?',
    [branch.site_id],
  );

  return dbQueryOne<SiteBranch>(db, 'SELECT * FROM site_branches WHERE id = ?', [branchId]);
}

/**
 * Close a branch without merging (rejected or abandoned).
 */
export async function closeBranch(
  db: D1Database,
  branchId: string,
): Promise<SiteBranch | null> {
  await dbUpdate(db, 'site_branches', { status: 'closed' }, 'id = ?', [branchId]);
  return dbQueryOne<SiteBranch>(db, 'SELECT * FROM site_branches WHERE id = ?', [branchId]);
}

/**
 * List all branches for a site, ordered by newest first.
 */
export async function listBranches(
  db: D1Database,
  siteId: string,
): Promise<SiteBranch[]> {
  const { data } = await dbQuery<SiteBranch>(
    db,
    `SELECT sb.*, COUNT(sba.id) AS approval_count
       FROM site_branches sb
       LEFT JOIN site_branch_approvals sba ON sba.branch_id = sb.id
      WHERE sb.site_id = ? AND sb.deleted_at IS NULL
      GROUP BY sb.id
      ORDER BY sb.created_at DESC`,
    [siteId],
  );
  return data;
}

/**
 * Resolve a branch from a hostname of the form `{branch}--{slug}.projectsites.dev`.
 * Returns `{ slug, branchName }` or `null` when the host does not match the pattern.
 */
export function parseBranchHost(
  hostname: string,
): { slug: string; branchName: string } | null {
  // Pattern: {branch}--{slug}.projectsites.dev
  const m = hostname.match(/^([a-z0-9-]+)--([a-z0-9-]+)\.projectsites\.dev$/i);
  if (!m) return null;
  return { branchName: m[1].toLowerCase(), slug: m[2].toLowerCase() };
}
