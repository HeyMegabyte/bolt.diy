/**
 * @module e2e/collab
 * @description Production gating smoke for the collab_editing feature
 * (`GET /api/sites/:id/collab`). The feature ships INERT — the flag is OFF and
 * the COLLAB_ROOM Durable Object binding is commented in wrangler.toml — so this
 * spec asserts the live guard chain returns the correct gated responses against
 * PROD rather than exercising a real WebSocket session.
 *
 * Live behaviour (re-verified 2026-08-01):
 * - unauthenticated → 401
 * - authenticated + owned site → 404 (flag off) OR 503 (flag on + COLLAB_ROOM DO
 *   absent). A global "ensure all flags on" override (set by Brian 2026-06-27) is
 *   currently live, so this returns 503 — the DESIGNED response for flag-on-but-
 *   DO-inert, still leak-free. The gate stays correct whichever way the flag sits.
 * - authenticated + UNowned site → 404 (ownership check precedes the flag check)
 *
 * Run:
 * ```sh
 * PROD_URL=https://projectsites.dev E2E_API_KEY=psk_test_… \
 *   npx playwright test collab --config playwright.prod.config.ts
 * ```
 *
 * @see {@link ../src/routes/collab.ts} — the gateway under test
 * @see {@link ../src/durable_objects/collab_room.ts} — CollabRoomDO (inert)
 */

import { resilientGet } from './helpers/api-request.js';
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';
const API_KEY = process.env.E2E_API_KEY;

/** A site owned by the E2E test org (`e2e-test-org`). */
const OWNED_SITE = 'e2e-site-1';
/** A site NOT owned by the E2E test org. */
const UNOWNED_SITE = 'site-megabytespace-001';

const collabPath = (siteId: string): string =>
  `${PROD_URL}/api/sites/${siteId}/collab`;

test.describe('collab_editing gateway — production gating (inert feature)', () => {
  test('unauthenticated request is rejected with 401', async ({ request }) => {
    const res = await resilientGet(request, collabPath(OWNED_SITE));
    expect(res.status()).toBe(401);
  });

  test('authenticated owned-site request returns a clean dark gate (404 flag-off | 503 inert-DO), never a leak', async ({
    request,
  }) => {
    test.skip(!API_KEY, 'E2E_API_KEY not set — skipping authenticated assertion');
    const res = await resilientGet(request, collabPath(OWNED_SITE), {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    // collab_editing ships INERT (COLLAB_ROOM DO commented in wrangler.toml). Both
    // gates are leak-free: 404 when the flag is off, 503 when the flag is on (the
    // live global override) but the DO binding is absent. Never 200 (would mean the
    // feature actually served), never 403 (would leak existence), never 401 (would
    // mean the session cleared out from under an authenticated caller).
    expect([404, 503]).toContain(res.status());
  });

  test('authenticated request for an unowned site returns 404', async ({ request }) => {
    test.skip(!API_KEY, 'E2E_API_KEY not set — skipping authenticated assertion');
    const res = await resilientGet(request, collabPath(UNOWNED_SITE), {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status()).toBe(404);
  });
});
