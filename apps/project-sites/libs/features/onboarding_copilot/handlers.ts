/**
 * @module libs/features/onboarding_copilot/handlers
 * @description Hono route handlers for the onboarding-copilot feature.
 * Provides a PLG activation checklist so new orgs discover their next-best-action.
 *
 * | Method | Path                          | Auth             |
 * | ------ | ----------------------------- | ---------------- |
 * | GET    | /api/onboarding/checklist     | Bearer API token |
 * | POST   | /api/onboarding/dismiss       | Bearer API token |
 *
 * Flag-gated: returns 404 (never 403) when the `onboarding_copilot` flag is off.
 *
 * @packageDocumentation
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { dbQueryOne } from '../../../src/services/db.js';
import { FLAG_KEY, buildChecklist, dismissedKey, DISMISS_TTL } from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const onboardingCopilot = new Hono<AppContext>();

/**
 * Flag-gate then resolve the caller's org. Returns a 404 `Response` when the
 * `onboarding_copilot` flag is off, a 401 `Response` when no org context is
 * present; otherwise the authorized `{ orgId }`.
 */
async function gate(c: Context<AppContext>): Promise<{ orgId: string } | Response> {
  if (!(await isFlagOn(c.env, FLAG_KEY, {}))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } }, 404);
  }
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401);
  }
  return { orgId };
}

/**
 * GET /api/onboarding/checklist
 *
 * Queries D1 for the org's activation signals (site count, published site count,
 * custom domain count) and KV for the dismissed state, then returns a typed
 * activation checklist with the recommended next action.
 *
 * @returns {@link ChecklistResponse} JSON on success.
 * @throws 404 when the flag is off.
 * @throws 401 when no authenticated orgId is present.
 */
onboardingCopilot.get('/checklist', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const { orgId } = g;

  const [siteRow, publishedRow, domainRow, rawDismissed] = await Promise.all([
    dbQueryOne<{ n: number }>(
      c.env.DB,
      'SELECT COUNT(*) as n FROM sites WHERE org_id = ? AND deleted_at IS NULL',
      [orgId],
    ),
    dbQueryOne<{ n: number }>(
      c.env.DB,
      "SELECT COUNT(*) as n FROM sites WHERE org_id = ? AND status = 'published' AND deleted_at IS NULL",
      [orgId],
    ),
    dbQueryOne<{ n: number }>(
      c.env.DB,
      "SELECT COUNT(*) as n FROM hostnames WHERE org_id = ? AND type = 'custom_cname' AND deleted_at IS NULL",
      [orgId],
    ),
    c.env.CACHE_KV.get(dismissedKey(orgId)),
  ]);

  const checklist = buildChecklist({
    hasSite: (siteRow?.n ?? 0) > 0,
    hasPublished: (publishedRow?.n ?? 0) > 0,
    hasDomain: (domainRow?.n ?? 0) > 0,
    dismissed: rawDismissed === '1',
  });

  return c.json(checklist, 200);
});

/**
 * POST /api/onboarding/dismiss
 *
 * Writes a 1-year dismissal flag to KV so the checklist widget is hidden
 * for this org. Returns `{dismissed: true}` on success.
 *
 * @returns `{dismissed: true}` JSON.
 * @throws 404 when the flag is off.
 * @throws 401 when no authenticated orgId is present.
 */
onboardingCopilot.post('/dismiss', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const { orgId } = g;

  await c.env.CACHE_KV.put(dismissedKey(orgId), '1', { expirationTtl: DISMISS_TTL });

  return c.json({ dismissed: true }, 200);
});
