/**
 * API coverage — code-export endpoint (flag `code_export`).
 *
 * `GET /api/sites/:siteId/export` packages a site's R2 assets AND the D1 schema
 * into a downloadable zip. An UNAUTHENTICATED caller MUST hit a leak-free gate —
 * 401 (no session), 403 (forbidden), or 404 (flag off / no existence leak) — and
 * MUST NEVER receive a 200 `application/zip` (which would exfiltrate site source
 * + the production database schema to an anonymous caller).
 *
 * This spec authenticates NOTHING, so it never downloads real content. It is the
 * regression guard for the auth/flag/ownership gate on the export route.
 *
 * @see {@link ../../src/index.ts} — the export route registration
 * @see {@link ../../libs/features/code_export/handlers.ts} — handleCodeExport
 */

import { test, expect } from '@playwright/test';

const PROD = process.env.PROD_URL ?? 'https://projectsites.dev';

/** The only leak-free responses for an unauthenticated caller to the export route. */
const GATE = [401, 403, 404];

/** siteIds an anonymous caller might try — a plausible slug and an obvious probe. */
const SITE_IDS = ['test-site', 'e2e-site-1'];

test.describe('Code export — unauthenticated safety gate (P10 coverage)', () => {
  for (const siteId of SITE_IDS) {
    test(`GET /api/sites/${siteId}/export — unauth is gated, never returns a zip`, async ({
      request,
    }) => {
      const res = await request.get(`${PROD}/api/sites/${siteId}/export`);
      expect(
        GATE,
        `an unauthenticated code-export must be gated — got ${res.status()}`,
      ).toContain(res.status());

      // Defense-in-depth: even on an unexpected 2xx, it must never be a zip payload.
      const contentType = res.headers()['content-type'] ?? '';
      expect(
        contentType,
        'unauthenticated export must never stream a zip',
      ).not.toContain('application/zip');
    });
  }
});
