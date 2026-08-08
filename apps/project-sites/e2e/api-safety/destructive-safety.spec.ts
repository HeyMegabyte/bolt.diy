/**
 * API coverage — destructive / mutating site routes.
 *
 * `DELETE /api/sites/:id`, `POST /api/sites/:id/reset`, `.../publish-bolt`,
 * `PATCH /api/sites/:id`, and the org-scoped `GET /api/sites/:id` all mutate or
 * read tenant data. An UNAUTHENTICATED caller MUST hit a leak-free gate —
 * 401 / 403 / 404 — and MUST NEVER get a 2xx (which would mean the endpoint
 * deleted / reset / published / mutated / leaked) nor a 5xx (unhandled crash).
 *
 * This spec authenticates NOTHING and uses only the `request` fixture, so it
 * never mutates prod. It is the regression guard for the auth/ownership gate on
 * the destructive site surface. Same class as the Pass-25 code-export leak.
 *
 * @see {@link ../../src/routes/api.ts}
 */
import { test, expect } from '@playwright/test';
import { resilientGet, resilientPost } from '../helpers/api-request.js';

const PROD = process.env.PROD_URL ?? 'https://projectsites.dev';

/** The only leak-free responses for an unauthenticated caller. */
const GATE = [401, 403, 404];

const ID = 'e2e-probe-1';

test.describe('Destructive site routes — unauthenticated safety gate (P10 coverage)', () => {
  test('DELETE /api/sites/:id — unauth is gated, never deletes', async ({ request }) => {
    const res = await request.delete(`${PROD}/api/sites/${ID}`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('POST /api/sites/:id/reset — unauth is gated, never resets', async ({ request }) => {
    const res = await resilientPost(request, `${PROD}/api/sites/${ID}/reset`, { data: {} });
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('POST /api/sites/:id/publish-bolt — unauth is gated, never publishes', async ({ request }) => {
    const res = await resilientPost(request, `${PROD}/api/sites/${ID}/publish-bolt`, { data: {} });
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('PATCH /api/sites/:id — unauth is gated, never mutates', async ({ request }) => {
    const res = await request.patch(`${PROD}/api/sites/${ID}`, { data: { businessName: 'x' } });
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('GET /api/sites/:id — unauth is gated, never leaks org-scoped data', async ({ request }) => {
    const res = await resilientGet(request, `${PROD}/api/sites/${ID}`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  // TDD Contract #10 — pathological :id values must all stay 4xx-gated
  // (never a 2xx read/leak, never a 5xx crash from a malformed id).
  const MALFORMED = [
    'a'.repeat(5000),
    '../../etc/passwd',
    "' OR 1=1--",
    '<script>alert(1)</script>',
    '你好-site',
    '%00null',
  ];
  for (const raw of MALFORMED) {
    test(`GET /api/sites/:id value-domain — ${raw.slice(0, 24)} stays gated, never 5xx`, async ({
      request,
    }) => {
      const res = await resilientGet(request, `${PROD}/api/sites/${encodeURIComponent(raw)}`);
      const s = res.status();
      expect(s, `malformed id must be 4xx-gated — got ${s}`).toBeGreaterThanOrEqual(400);
      expect(s, `malformed id must never 5xx — got ${s}`).toBeLessThan(500);
    });
  }
});
