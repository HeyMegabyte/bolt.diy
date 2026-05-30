/**
 * @module routes/site_branches
 * @description Branch-style site preview API (#27).
 *
 * | Method | Path                                           | Purpose                        |
 * | ------ | ---------------------------------------------- | ------------------------------ |
 * | GET    | `/api/sites/:siteId/branches`                  | List branches for a site       |
 * | POST   | `/api/sites/:siteId/branches`                  | Create a new branch            |
 * | POST   | `/api/sites/:siteId/branches/:branchId/review` | Request review (+ Slack notify)|
 * | POST   | `/api/sites/:siteId/branches/:branchId/approve`| Approve a branch               |
 * | POST   | `/api/sites/:siteId/branches/:branchId/merge`  | Merge to production            |
 * | POST   | `/api/sites/:siteId/branches/:branchId/close`  | Close / reject a branch        |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { unauthorized, notFound } from '@project-sites/shared';
import { dbQueryOne } from '../services/db.js';
import {
  createBranch,
  listBranches,
  requestReview,
  approveBranch,
  mergeBranch,
  closeBranch,
} from '../services/site_branches.js';

const siteBranchesApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Assert the authenticated caller's org owns `siteId`.
 *
 * @remarks Multi-tenant isolation gate for every branch route. A missing
 * session throws `unauthorized()` (401); a site owned by another org (or a
 * non-existent site) throws `notFound()` (404, **never 403** — a 403 would
 * confirm the site exists to a caller who shouldn't know that). The branch
 * mutation services additionally scope by `site_id` in SQL, so even the
 * `:branchId` is tenant-checked, not just the `:siteId`.
 * @param c      - Hono context (reads `orgId`/`userId` set by auth middleware)
 * @param siteId - the site id from the URL path
 * @returns the verified `{ orgId, userId }`
 * @throws {AppError} `unauthorized` (401) when no session; `notFound` (404) when the site is not owned by the caller
 * @see {@link requestReview} for the SQL-level `site_id` scoping on branch ids
 */
async function assertOwner(
  c: { env: Env; get: (k: string) => string | undefined },
  siteId: string,
): Promise<{ orgId: string; userId: string }> {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) throw unauthorized();
  const row = await dbQueryOne<{ org_id: string }>(
    c.env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  if (!row || row.org_id !== orgId) throw notFound('Site not found');
  return { orgId, userId };
}

// ─── List branches ────────────────────────────────────────────────────────────

siteBranchesApp.get('/api/sites/:siteId/branches', async (c) => {
  const siteId = c.req.param('siteId');
  await assertOwner(c, siteId);
  const branches = await listBranches(c.env.DB, siteId);
  return c.json({ branches });
});

// ─── Create branch ────────────────────────────────────────────────────────────

const createBranchSchema = z.object({
  branch_name: z.string().min(1).max(64),
  approvals_required: z.number().int().min(1).max(10).optional(),
});

siteBranchesApp.post(
  '/api/sites/:siteId/branches',
  zValidator('json', createBranchSchema),
  async (c) => {
    const siteId = c.req.param('siteId');
    const { userId } = await assertOwner(c, siteId);
    const body = c.req.valid('json');

    // Resolve the site slug so we can build the preview URL.
    const siteRow = await dbQueryOne<{ slug: string }>(
      c.env.DB,
      'SELECT slug FROM sites WHERE id = ? AND deleted_at IS NULL',
      [siteId],
    );
    if (!siteRow) return c.json({ error: 'site_not_found' }, 404);

    const branch = await createBranch(c.env.DB, siteId, userId, {
      branchName: body.branch_name,
      slug: siteRow.slug,
      approvalsRequired: body.approvals_required,
    });

    return c.json({ branch }, 201);
  },
);

// ─── Request review ───────────────────────────────────────────────────────────

siteBranchesApp.post('/api/sites/:siteId/branches/:branchId/review', async (c) => {
  const siteId = c.req.param('siteId');
  await assertOwner(c, siteId);
  const branchId = c.req.param('branchId');

  // Pass Slack webhook URL if configured via env var (optional secret, not in typed Env).
  const slackUrl = (c.env as unknown as Record<string, string | undefined>)[
    'BRANCHES_SLACK_WEBHOOK'
  ];
  const branch = await requestReview(c.env.DB, siteId, branchId, slackUrl);
  if (!branch) return c.json({ error: 'branch_not_found_or_not_draft' }, 404);
  return c.json({ branch });
});

// ─── Approve branch ───────────────────────────────────────────────────────────

siteBranchesApp.post('/api/sites/:siteId/branches/:branchId/approve', async (c) => {
  const siteId = c.req.param('siteId');
  const { userId } = await assertOwner(c, siteId);
  const branchId = c.req.param('branchId');
  const result = await approveBranch(c.env.DB, siteId, branchId, userId);
  if (!result) return c.json({ error: 'branch_not_found_or_not_in_review' }, 404);
  return c.json(result);
});

// ─── Merge branch ─────────────────────────────────────────────────────────────

const mergeBranchSchema = z.object({
  build_version: z.string().min(1),
});

siteBranchesApp.post(
  '/api/sites/:siteId/branches/:branchId/merge',
  zValidator('json', mergeBranchSchema),
  async (c) => {
    const siteId = c.req.param('siteId');
    await assertOwner(c, siteId);
    const branchId = c.req.param('branchId');
    const { build_version } = c.req.valid('json');
    const branch = await mergeBranch(c.env.DB, siteId, branchId, build_version);
    if (!branch) return c.json({ error: 'branch_not_found_or_not_mergeable' }, 404);
    return c.json({ branch });
  },
);

// ─── Close branch ─────────────────────────────────────────────────────────────

siteBranchesApp.post('/api/sites/:siteId/branches/:branchId/close', async (c) => {
  const siteId = c.req.param('siteId');
  await assertOwner(c, siteId);
  const branchId = c.req.param('branchId');
  const branch = await closeBranch(c.env.DB, siteId, branchId);
  if (!branch) return c.json({ error: 'branch_not_found' }, 404);
  return c.json({ branch });
});

export { siteBranchesApp };
