/**
 * @module libs/features/audit_trail_export/handlers
 * @description Hono route handlers for the audit_trail_export feature.
 * Org admins filter and download their audit log as JSON or CSV.
 *
 * | Method | Path                  | Auth                   |
 * | ------ | --------------------- | ---------------------- |
 * | GET    | /api/audit/export     | Bearer API token       |
 *
 * Flag-gated: returns 404 (never 403) when the `audit_trail_export` flag is off.
 *
 * @packageDocumentation
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { dbQuery } from '../../../src/services/db.js';
import { AuditExportQuerySchema } from './schemas.js';
import { FLAG_KEY, buildAuditQuery, rowsToCsv } from './service.js';
import type { AuditLogEntry } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const auditTrailExport = new Hono<AppContext>();

/**
 * GET /api/audit/export
 *
 * Returns the caller org's audit log filtered by optional action/from/to params.
 * Responds with `application/json` or `text/csv` depending on `?format=`.
 *
 * @returns JSON `{ count, entries }` or CSV attachment on success.
 *
 * @throws 404 when the flag is off.
 * @throws 401 when no authenticated orgId is present.
 * @throws 400 when query params fail Zod validation.
 */
auditTrailExport.get('/', async (c) => {
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
  const queryParsed = AuditExportQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!queryParsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters.' } }, 400);
  }

  const query = queryParsed.data;

  // 4. Build and run the SQL — org_id is ALWAYS in the WHERE clause.
  const { sql, params } = buildAuditQuery(orgId, query);
  const { data: rows } = await dbQuery<AuditLogEntry>(c.env.DB, sql, params);
  const entries = rows ?? [];

  // 5. Respond in the requested format.
  if (query.format === 'csv') {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const csv = rowsToCsv(entries);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-${date}.csv"`,
      },
    });
  }

  return c.json({ count: entries.length, entries }, 200);
});
