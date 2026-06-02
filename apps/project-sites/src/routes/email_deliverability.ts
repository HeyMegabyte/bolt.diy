/**
 * @module routes/email_deliverability
 * @description Email Deliverability Wizard API — feature #12 (P1).
 *
 * Route (mounted at `/`):
 *   GET /api/sites/:siteId/deliverability[?domain=]
 *     → { ok, report } where report is the SPF/DKIM/DMARC score + fixes.
 *
 * Gated by the `email_deliverability_wizard` flag — returns 404 (never 403)
 * when off so feature existence never leaks. Ownership enforced via the shared
 * `assertSiteOwned` guard (404 on missing/foreign site). The sending domain is
 * taken from `?domain=` (the address mail is actually sent from) or falls back
 * to the site's primary custom hostname; 400 when neither is available.
 *
 * Read-only: performs DNS-over-HTTPS lookups only, persists nothing.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assertSiteOwned } from '../services/site_ownership.js';
import { checkDeliverability, normalizeDomain } from '../services/email_deliverability.js';
import { dbQueryOne } from '../services/db.js';

/** 404 (never 403/leak) when off or the :siteId isn't owned by the caller's org. */
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Not found' } } as const;

const emailDeliverabilityRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

emailDeliverabilityRoutes.get('/api/sites/:siteId/deliverability', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId } = c.req.param();
  const orgId = c.get('orgId');

  if (!(await isFlagOn(c.env, 'email_deliverability_wizard', { siteId, orgId }))) {
    return c.json(NOT_FOUND, 404);
  }
  if (!(await assertSiteOwned(c.env, orgId, siteId))) return c.json(NOT_FOUND, 404);

  // Prefer an explicit sending domain; else the site's primary custom hostname.
  const override = c.req.query('domain');
  let domain = override ? normalizeDomain(override) : '';
  if (!domain) {
    const row = await dbQueryOne<{ hostname: string }>(
      c.env.DB,
      "SELECT hostname FROM hostnames WHERE site_id = ? AND type = 'custom_cname' AND deleted_at IS NULL LIMIT 1",
      [siteId],
    );
    if (row?.hostname) domain = normalizeDomain(row.hostname);
  }
  if (!domain) {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'No sending domain to check — connect a custom domain or pass ?domain=',
        },
      },
      400,
    );
  }

  const report = await checkDeliverability(fetch, domain);
  return c.json({ ok: true, report });
});

export { emailDeliverabilityRoutes };
