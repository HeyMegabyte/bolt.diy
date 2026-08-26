/**
 * @module libs/features/sheets/handlers
 *
 * @description
 * Hono routes proxying **public Google Sheets** reads for site widgets (menus,
 * price lists, schedules an owner maintains in a Sheet). Two GETs: fetch a tab's
 * rows-as-records, and discover a sheet's tabs. Both are unauthenticated — the
 * data is already public ("anyone with the link") and carries no tenant secret.
 *
 * | Method | Path                      | Auth   | Purpose                     |
 * | ------ | ------------------------- | ------ | --------------------------- |
 * | GET    | /api/sheets/:sheetId      | public | Rows-as-records (`?tab=`)   |
 * | GET    | /api/sheets/:sheetId/meta | public | Tab discovery (name + dims) |
 *
 * Extracted verbatim from the `api.ts` monolith (route-decomposition
 * installment 4). **Core, un-gated** routes — a route-organization module, not a
 * dark-launched feature. Both routes delegate to `services/google_sheets.ts`
 * (`fetchSheetData` / `fetchSheetMeta`); the API key resolves
 * `GOOGLE_SHEETS_API_KEY` first, falling back to `GOOGLE_PLACES_API_KEY` (same GCP
 * project, Sheets API enabled). No request body is parsed and the only inputs are
 * a path param + a `tab` query, so there is no `schemas.ts`; upstream errors
 * (private sheet 403, bad id 400, quota 429) bubble to the app-level error handler
 * unchanged.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { fetchSheetData, fetchSheetMeta } from '../../../src/services/google_sheets.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const sheets = new Hono<AppContext>();

sheets.get('/api/sheets/:sheetId', async (c) => {
  const sheetId = c.req.param('sheetId');
  const tab = c.req.query('tab');
  const apiKey = c.env.GOOGLE_SHEETS_API_KEY || c.env.GOOGLE_PLACES_API_KEY;
  const data = await fetchSheetData(sheetId, tab || undefined, apiKey);
  return c.json({ data, count: data.length });
});

sheets.get('/api/sheets/:sheetId/meta', async (c) => {
  const sheetId = c.req.param('sheetId');
  const apiKey = c.env.GOOGLE_SHEETS_API_KEY || c.env.GOOGLE_PLACES_API_KEY;
  const tabs = await fetchSheetMeta(sheetId, apiKey);
  return c.json({ tabs });
});
