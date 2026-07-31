/**
 * @module e2e/collab
 * @description Production gating smoke for the collab_editing feature
 * (`GET /api/sites/:id/collab`). The feature ships INERT — the flag is OFF and
 * the COLLAB_ROOM Durable Object binding is commented in wrangler.toml — so this
 * spec asserts the live guard chain returns the correct gated responses against
 * PROD rather than exercising a real WebSocket session.
 *
 * Live behaviour verified (Version 33ed1529, 2026-06-24):
 * - unauthenticated → 401
 * - authenticated + owned site + flag OFF → 404 (never 403; no info leak)
 * - authenticated + UNowned site → 404
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

  test('authenticated owned-site request returns 404 while the flag is off', async ({
    request,
  }) => {
    test.skip(!API_KEY, 'E2E_API_KEY not set — skipping authenticated assertion');
    const res = await resilientGet(request, collabPath(OWNED_SITE), {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    // Flag is OFF → 404 (never 403). The route never leaks feature existence.
    expect(res.status()).toBe(404);
  });

  test('authenticated request for an unowned site returns 404', async ({ request }) => {
    test.skip(!API_KEY, 'E2E_API_KEY not set — skipping authenticated assertion');
    const res = await resilientGet(request, collabPath(UNOWNED_SITE), {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status()).toBe(404);
  });
});
