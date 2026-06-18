/**
 * @module libs/features/deploy_buttons/handlers
 * @description Hono route handlers for the deploy-buttons feature.
 * Generates one-click Deploy button and "hosted-on" badge snippets for
 * embedding in GitHub READMEs and site footers.
 *
 * | Method | Path                                  | Auth                   |
 * | ------ | ------------------------------------- | ---------------------- |
 * | GET    | /api/deploy-buttons/:siteId           | Bearer API token       |
 *
 * Flag-gated: returns 404 (never 403) when the `deploy_buttons` flag is off.
 *
 * @packageDocumentation
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { dbQueryOne } from '../../../src/services/db.js';
import { DeployButtonsQuerySchema } from './schemas.js';
import { FLAG_KEY, generateDeploySnippets } from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const deployButtons = new Hono<AppContext>();

/**
 * GET /api/deploy-buttons/:siteId
 *
 * Returns badge + deploy-button markdown / HTML snippets for the requested
 * site. The caller must own the site (orgId check against D1).
 *
 * @param siteId - The site's UUID from the D1 `sites` table.
 * @returns {@link DeployButtonsResponse} JSON on success.
 *
 * @throws 404 when the flag is off or the site does not belong to the org.
 * @throws 401 when no authenticated orgId is present.
 * @throws 400 when query params fail Zod validation.
 */
deployButtons.get('/:siteId', async (c) => {
  // 1. Feature flag gate — 404 (never 403) when disabled.
  if (!(await isFlagOn(c.env, FLAG_KEY, {}))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } }, 404);
  }

  // 2. Auth — orgId is injected by the auth middleware upstream.
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401);
  }

  // 3. Validate query params.
  const queryParsed = DeployButtonsQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!queryParsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters.' } }, 400);
  }

  const siteId = c.req.param('siteId');

  // 4. Ownership check — confirm the site belongs to this org.
  const site = await dbQueryOne<{
    id: string;
    slug: string;
    business_name: string;
    primary_hostname: string | null;
  }>(
    c.env.DB,
    'SELECT id, slug, business_name, primary_hostname FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );

  if (!site) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found.' } }, 404);
  }

  // 5. Generate snippets — pure logic, no I/O.
  const siteUrl = site.primary_hostname
    ? `https://${site.primary_hostname}`
    : `https://${site.slug}.projectsites.dev`;

  const snippets = generateDeploySnippets(
    { id: site.id, slug: site.slug, business_name: site.business_name, url: siteUrl },
    queryParsed.data,
  );

  return c.json(snippets, 200);
});
