/**
 * @module libs/features/contacts_core/handlers
 * @description Hono routes for Contacts Core (CRM).
 *
 * | Method | Path                | Purpose                          |
 * | ------ | ------------------- | -------------------------------- |
 * | GET    | /api/contacts       | List caller-org contacts         |
 * | POST   | /api/contacts       | Upsert a contact (dedupe)        |
 * | GET    | /api/contacts/:id   | Fetch one caller-org contact     |
 * | DELETE | /api/contacts/:id   | Soft-delete a caller-org contact |
 *
 * Auth + flag gate + error envelopes come from the shared `feature_guard`
 * (`requireOrgFlag`): all routes 404 when the `contacts_core` flag is off (never
 * 403 — don't leak existence) and are org-scoped from the authenticated context,
 * so cross-org access is impossible by construction.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { requireOrgFlag, notFound, badRequest } from '../../../src/lib/feature_guard.js';
import { FLAG_KEY, recordContact, getContact, listContacts, deleteContact } from './service.js';
import {
  UpsertContactSchema,
  ListContactsQuerySchema,
  ListContactsResponseSchema,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const contactsCore = new Hono<AppContext>();

contactsCore.get('/api/contacts', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;
  const parsed = ListContactsQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) return badRequest(c, parsed.error.flatten());
  const { contacts, total } = await listContacts(c.env, g.orgId, parsed.data);
  return c.json(
    ListContactsResponseSchema.parse({
      contacts,
      total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    }),
  );
});

contactsCore.post('/api/contacts', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;
  const body = await c.req.json().catch(() => null);
  // org is taken from the auth context, never the body — prevents cross-org writes.
  // `...body` is safe when body is null/undefined (object spread of falsy is a no-op);
  // a non-object body yields junk keys that `.strict()` then rejects as a 400.
  const parsed = UpsertContactSchema.safeParse({ ...body, orgId: g.orgId });
  if (!parsed.success) return badRequest(c, parsed.error.flatten());
  const contact = await recordContact(c.env, parsed.data);
  return c.json({ contact }, 201);
});

contactsCore.get('/api/contacts/:id', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;
  const contact = await getContact(c.env, g.orgId, c.req.param('id'));
  if (!contact) return notFound(c);
  return c.json({ contact });
});

contactsCore.delete('/api/contacts/:id', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;
  const ok = await deleteContact(c.env, g.orgId, c.req.param('id'));
  if (!ok) return notFound(c);
  return c.json({ deleted: true });
});
