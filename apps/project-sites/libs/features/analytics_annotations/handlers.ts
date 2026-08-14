import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { CreateAnnotationSchema } from './schemas.js';
import { listAnnotations, createAnnotation, deleteAnnotation } from './service.js';

export async function handleListAnnotations(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  if (!(await isFlagOn(c.env, 'activity_feed', { orgId: c.get('orgId')! }))) return c.notFound();
  return c.json({ data: await listAnnotations(c.env, c.req.param('siteId')) });
}

export async function handleCreateAnnotation(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  if (!(await isFlagOn(c.env, 'activity_feed', { orgId: c.get('orgId')! }))) return c.notFound();
  const body = CreateAnnotationSchema.parse(await c.req.json());
  try { return c.json(await createAnnotation(c.env, c.get('orgId')!, body.siteId, body.date, body.note, body.category), 201); }
  catch (e: unknown) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 404); }
}

export async function handleDeleteAnnotation(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  if (!(await isFlagOn(c.env, 'activity_feed', { orgId: c.get('orgId')! }))) return c.notFound();
  await deleteAnnotation(c.env, c.req.param('id'));
  return c.body(null, 204);
}
