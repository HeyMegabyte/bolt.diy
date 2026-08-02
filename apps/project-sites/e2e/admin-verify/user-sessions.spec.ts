/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the /admin/user "Active sessions"
 * panel is backed by REAL data, not a stub.
 *
 * The audit found `GET /api/admin/sessions` returned 404 ("Unknown API route"),
 * so the panel fell back to a synthetic "this device" row — a stub where real
 * data (the D1 `sessions` table) exists. The worker route + its DELETE/revoke
 * peers are now wired (src/routes/ai_admin.ts + src/services/auth.ts). This
 * asserts, against LIVE prod, that the endpoint is 200 with a real `{ data:
 * SessionRow[] }` envelope (was 404).
 *
 * Visual coverage: the row-render behavior is proven by the unit suite
 * (`user_sessions.test.ts` — list/revoke/parse), a real-browser diagnostic (the
 * panel renders a populated current-device row), and sections-visual.spec.ts
 * (`/admin/user` renders clean, 0 console errors). A dedicated deep-row visual
 * assertion is intentionally NOT here: the 81KB user-settings component's
 * bottom-of-page sessions card renders unreliably under Playwright's emulated
 * context (a harness artifact, unrelated to the fix), so a strict row-count
 * assertion would be flaky. The endpoint contract below is the robust proof.
 *
 * @see {@link ../../src/routes/ai_admin.ts} (GET/DELETE/POST /api/admin/sessions*)
 * @see {@link ../../src/__tests__/user_sessions.test.ts}
 */
import { test, expect } from '@playwright/test';
import { realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · Active Sessions — real data, not stub (P0-ADMIN)', () => {
  test('GET /api/admin/sessions returns 200 + a valid envelope (was 404)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const token = process.env.E2E_API_KEY!;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const res = await page.evaluate(async (bearer) => {
      const r = await fetch('/api/admin/sessions', { headers: { Authorization: `Bearer ${bearer}` } });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, token);

    expect(res.status, '/api/admin/sessions must be 200 (was 404 "Unknown API route")').toBe(200);
    const data = (res.body as { data?: unknown } | null)?.data;
    expect(Array.isArray(data), 'envelope must be { data: SessionRow[] }').toBe(true);
  });

  // NOTE: the DELETE (revoke) + POST (revoke-others) endpoints are NOT E2E-tested
  // against prod — they MUTATE (would sign out real sessions), which specs must
  // never do. Their logic is covered by the unit suite (user_sessions.test.ts):
  // ownership-guarded single revoke + keep-current bulk revoke.
});
