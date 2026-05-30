/**
 * @module libs/features/data_export/handlers
 * @description Hono route for Data Export.
 *
 * | Method | Path                         | Purpose                          |
 * | ------ | ---------------------------- | -------------------------------- |
 * | GET    | /api/exports/contacts.csv    | Download org contacts as CSV     |
 *
 * 404 when the `data_export` flag is off. Org-scoped from the auth context —
 * a caller can only export their own org's contacts. Path avoids
 * `/api/contacts/:id` so it never collides with the contacts_core route.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { requireOrgFlag, badRequest } from '../../../src/lib/feature_guard.js';
import { ExportContactsQuerySchema } from './schemas.js';
import { FLAG_KEY, exportContactsCsv } from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const dataExport = new Hono<AppContext>();

dataExport.get('/api/exports/contacts.csv', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;

  const parsed = ExportContactsQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) return badRequest(c, parsed.error.flatten());

  const csv = await exportContactsCsv(c.env, g.orgId, parsed.data.siteId);
  const stamp = new Date().toISOString().slice(0, 10);
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="contacts-${stamp}.csv"`,
    'Cache-Control': 'no-store',
  });
});
