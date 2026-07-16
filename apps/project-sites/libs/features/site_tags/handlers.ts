/**
 * Site Tags handlers — Hono route handlers for org-scoped tag CRUD.
 *
 * All routes require auth (orgId from middleware). Flag-gated behind `site_tags`
 * (default-off, experimental).
 *
 * @module libs/features/site_tags/handlers
 */
import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import {
  CreateTagSchema,
  UpdateTagSchema,
  SetSiteTagsSchema,
  type ListTagsResponse,
} from './schemas.js';
import {
  createTag,
  updateTag,
  deleteTag,
  listTags,
  setSiteTags,
  getSiteTags,
} from './service.js';

/** All site-tag routes under /api/site-tags */
export async function handleListTags(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  const orgId = c.get('orgId')!;
  if (!(await isFlagOn(c.env, 'site_tags', { orgId }))) return c.notFound();
  const tags = await listTags(c.env, orgId);
  return c.json({ data: tags } satisfies ListTagsResponse);
}

export async function handleCreateTag(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  const orgId = c.get('orgId')!;
  if (!(await isFlagOn(c.env, 'site_tags', { orgId }))) return c.notFound();
  const body = CreateTagSchema.parse(await c.req.json());
  const tag = await createTag(c.env, orgId, body);
  return c.json(tag, 201);
}

export async function handleUpdateTag(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  const orgId = c.get('orgId')!;
  if (!(await isFlagOn(c.env, 'site_tags', { orgId }))) return c.notFound();
  const tagId = c.req.param('tagId');
  const body = UpdateTagSchema.parse(await c.req.json());
  const tag = await updateTag(c.env, orgId, tagId, body);
  if (!tag) return c.notFound();
  return c.json(tag);
}

export async function handleDeleteTag(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  const orgId = c.get('orgId')!;
  if (!(await isFlagOn(c.env, 'site_tags', { orgId }))) return c.notFound();
  const tagId = c.req.param('tagId');
  await deleteTag(c.env, orgId, tagId);
  return c.body(null, 204);
}

export async function handleSetSiteTags(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  const orgId = c.get('orgId')!;
  const siteId = c.req.param('siteId');
  if (!(await isFlagOn(c.env, 'site_tags', { orgId, siteId }))) return c.notFound();
  const body = SetSiteTagsSchema.parse(await c.req.json());
  const tags = await setSiteTags(c.env, siteId, body);
  return c.json({ data: tags });
}

export async function handleGetSiteTags(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  const siteId = c.req.param('siteId');
  const tags = await getSiteTags(c.env, siteId);
  return c.json({ data: tags });
}
