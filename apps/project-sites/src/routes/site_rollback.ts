/**
 * @module routes/site_rollback
 *
 * POST /api/sites/:siteId/rollback — roll back a site to a previous GitHub commit.
 * GET  /api/sites/:siteId/history  — list commit history for the rollback UI.
 *
 * Both endpoints are flag-gated behind `github_repo_sync` (experimental, default-off).
 * Requires GITHUB_REPO_TOKEN set in wrangler secrets.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { getHistory, rollback } from '../services/github_repo.js';
import { z } from 'zod';

const rollbackSchema = z.object({
  commitSha: z.string().min(7).max(40),
});

export const siteRollbackRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  /**
   * GET /api/sites/:siteId/history — list recent commits for the rollback UI.
   */
  .get('/api/sites/:siteId/history', async (c) => {
    const siteId = c.req.param('siteId');
    const orgId = c.get('orgId');

    if (!(await isFlagOn(c.env, 'github_repo_sync', { orgId: orgId, siteId: siteId }))) {
      return c.notFound();
    }

    try {
      const history = await getHistory(c.env, siteId);
      return c.json({ data: history });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { code: 'GITHUB_ERROR', message } }, 502);
    }
  })

  /**
   * POST /api/sites/:siteId/rollback — roll back to a previous commit.
   *
   * Body: { commitSha: string }
   *
   * Creates a revert commit on the GitHub repo, then the caller should
   * trigger a redeploy. The rollback itself is instant (tree-restore);
   * the redeploy rebuilds the site from the reverted state.
   */
  .post('/api/sites/:siteId/rollback', async (c) => {
    const siteId = c.req.param('siteId');
    const orgId = c.get('orgId');

    if (!(await isFlagOn(c.env, 'github_repo_sync', { orgId: orgId, siteId: siteId }))) {
      return c.notFound();
    }

    const parsed = rollbackSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'commitSha is required (7-40 char hex)' } },
        400,
      );
    }

    try {
      const commit = await rollback(c.env, siteId, parsed.data.commitSha);
      return c.json({
        data: {
          sha: commit.sha,
          message: commit.message,
          url: commit.url,
          next: 'Trigger a redeploy to apply the rollback to the live site.',
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('not found') ? 404 : 502;
      return c.json({ error: { code: 'ROLLBACK_FAILED', message } }, status);
    }
  });
