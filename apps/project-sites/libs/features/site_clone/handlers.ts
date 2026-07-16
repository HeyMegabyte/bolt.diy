import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { CloneSiteSchema } from './schemas.js';
import { cloneSite } from './service.js';

export async function handleSiteClone(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  if (!(await isFlagOn(c.env, 'site_clone', { orgId: c.get('orgId')! }))) return c.notFound();
  const body = CloneSiteSchema.parse(await c.req.json());
  try { return c.json(await cloneSite(c.env, c.get('orgId')!, body.sourceSiteId, body.targetSlug, body.targetName), 201); }
  catch (e: unknown) { const m = e instanceof Error ? e.message : String(e); return c.json({ error: m }, m === 'source_not_found' ? 404 : 409); }
}
