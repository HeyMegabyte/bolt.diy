import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import {
  deleteVisitorData,
  exportVisitorData,
  verifySiteOwnership,
  writeDsarAuditLog,
} from './service.js';
import { DsarBodySchema } from './schemas.js';

const FLAG_KEY = 'visitor_dsar';

type AppContext = { Bindings: Env; Variables: Variables };

export const visitorDsar = new Hono<AppContext>();

/**
 * POST /api/sites/:siteId/dsar
 *
 * Export or soft-delete a visitor's identities from a specific site on
 * behalf of the site owner in response to a GDPR/CCPA DSAR.
 *
 * Auth: Bearer token must resolve to an org that owns the requested site.
 * Feature flag: `visitor_dsar` — returns 404 when disabled.
 */
visitorDsar.post('/api/sites/:siteId/dsar', async (c) => {
  // 1. Feature-flag gate — 404, never 403
  if (!(await isFlagOn(c.env, FLAG_KEY, {}))) {
    return c.json({ error: 'Not found' }, 404);
  }

  // 2. Auth — orgId must be present on the request context
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // 3. Parse + validate request body
  const raw = await c.req.json().catch(() => null);
  const parsed = DsarBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Validation failed',
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const { subject, mode } = parsed.data;

  // 4. Site ownership check
  const siteId = c.req.param('siteId');
  const owned = await verifySiteOwnership(c.env.DB, siteId, orgId);
  if (!owned) {
    return c.json({ error: 'Not found' }, 404);
  }

  // 5. Execute the DSAR
  if (mode === 'export') {
    const records = await exportVisitorData(c.env.DB, siteId, subject);
    const actorId = (c.get('userId') as string | undefined) ?? orgId;
    c.executionCtx.waitUntil(
      writeDsarAuditLog(c.env.DB, {
        orgId,
        siteId,
        actorId,
        mode: 'export',
        subject,
        count: records.length,
      }).catch(() => undefined),
    );
    return c.json({ mode: 'export', records, count: records.length }, 200);
  }

  // mode === 'delete'
  const deleted = await deleteVisitorData(c.env.DB, siteId, subject);
  const actorId = (c.get('userId') as string | undefined) ?? orgId;
  c.executionCtx.waitUntil(
    writeDsarAuditLog(c.env.DB, {
      orgId,
      siteId,
      actorId,
      mode: 'delete',
      subject,
      count: deleted,
    }).catch(() => undefined),
  );
  return c.json({ mode: 'delete', deleted }, 200);
});
