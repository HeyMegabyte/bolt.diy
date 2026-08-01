/**
 * API coverage — unauthenticated auth-session surface.
 *
 * ⚠️ SAFETY: this spec NEVER authenticates and NEVER sends a real email. Every
 * magic-link input below is syntactically invalid / an injection payload / an
 * overlong string, so the server rejects it at validation BEFORE any send. No
 * real/deliverable address is ever used.
 *
 * Contracts (they differ per endpoint):
 * - `GET /api/auth/me` unauth → 200-with-no-user OR 401; never leaks a real user.
 * - `POST /api/auth/magic-link` invalid body → non-2xx (validation); never enqueues mail.
 * - `GET /api/auth/magic-link/verify?token=<garbage>` → rejected; never grants a session.
 *
 * @see {@link ../../src/routes/api.ts}
 */
import { test, expect } from '@playwright/test';

const PROD = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Auth session surface — unauthenticated safety (P10 coverage)', () => {
  test('GET /api/auth/me — unauth never leaks a user', async ({ request }) => {
    const res = await request.get(`${PROD}/api/auth/me`);
    expect([200, 401], `unexpected status ${res.status()}`).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json().catch(() => ({}));
      const user = body?.user ?? body?.data?.user ?? null;
      expect(user, 'unauth /api/auth/me must not return a populated user').toBeFalsy();
    }
  });

  // NEVER a real address — invalid/injection/overlong inputs only, so no email is sent.
  const INVALID_BODIES = [
    {},
    { email: '' },
    { email: 'not-an-email' },
    { email: 'a@b' },
    { email: "x@y.com'; DROP TABLE users;--" },
    { email: 'a'.repeat(5000) + '@x.com' },
    { email: '你好@example.com' },
  ];
  for (const [i, data] of INVALID_BODIES.entries()) {
    test(`POST /api/auth/magic-link — invalid body #${i} rejected, never sends`, async ({ request }) => {
      const res = await request.post(`${PROD}/api/auth/magic-link`, { data });
      expect(
        res.status(),
        `invalid magic-link body must be rejected (non-2xx) — got ${res.status()}`,
      ).toBeGreaterThanOrEqual(400);
    });
  }

  const GARBAGE_TOKENS = ['', 'deadbeef', '../../x', "' OR 1=1--", 'a'.repeat(2000)];
  for (const tok of GARBAGE_TOKENS) {
    test(`GET /api/auth/magic-link/verify — garbage token "${tok.slice(0, 16)}" grants nothing`, async ({
      request,
    }) => {
      const res = await request.get(
        `${PROD}/api/auth/magic-link/verify?token=${encodeURIComponent(tok)}`,
        { maxRedirects: 0 },
      );
      const s = res.status();
      // Never a 2xx JSON session grant.
      expect([200, 201, 204], `garbage token must not be accepted — got ${s}`).not.toContain(s);
      // If it redirects, the Location must NOT carry a minted session token.
      if (s >= 300 && s < 400) {
        const loc = res.headers()['location'] ?? '';
        expect(/token=|auth_callback|ps_session/i.test(loc), `redirect must not grant a session: ${loc}`).toBe(
          false,
        );
      }
    });
  }
});
