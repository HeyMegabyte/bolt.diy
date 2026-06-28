import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { assertSiteOwned } from '../../../src/services/site_ownership.js';
import { FLAG_KEY, querySearch, reindexSite } from './service.js';
import {
  SiteSearchQueryRequestSchema, SiteSearchQueryResponseSchema,
  SiteReindexRequestSchema, SiteReindexResponseSchema,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };
export const siteSemanticSearch = new Hono<AppContext>();

const unauthorized = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
const notFound = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  // Tenant guard — caller's org must own the site (covers query + reindex).
  if (!(await assertSiteOwned(c.env, c.get('orgId'), c.req.param('siteId')))) return notFound(c);
  return null;
}

siteSemanticSearch.post('/api/site-search/:siteId/query', zValidator('json', SiteSearchQueryRequestSchema), async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const { siteId } = c.req.param();
  const { query, topK } = c.req.valid('json');
  const results = await querySearch(c.env, siteId, query, topK);
  return c.json(SiteSearchQueryResponseSchema.parse({ results, query }));
});

siteSemanticSearch.post('/api/site-search/:siteId/reindex', zValidator('json', SiteReindexRequestSchema), async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const { siteId } = c.req.param();
  const body = c.req.valid('json');
  const indexed = await reindexSite(c.env, siteId, body);
  return c.json(SiteReindexResponseSchema.parse({ indexed, siteId }));
});
