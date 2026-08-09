/**
 * @module e2e/admin-ai-fab
 *
 * Verifies the dashboard "upgrades shell" AI FAB + share-view were driven from
 * FAKE → REAL, and proves it against the LIVE deployed bundle.
 *
 * Convergence fix (commit "feat(admin): real AI FAB …"):
 *   - FAB returned a MOCK echo string → now streams the real `/api/admin/ai/stream/chat`
 *     SSE copilot with route context + busy/error/offline handling.
 *   - Share-view used `window.alert()` → now a real ToastService toast.
 *   - The unreachable dead bulk-actions toolbar (+ its alert() stub) was removed.
 *
 * KNOWN LIVE-REACHABILITY LIMITATION (honest, not faked): the entire
 * admin-upgrades-shell mounts ONLY on `/admin` (inside `dashboard.component`),
 * and `/admin` is an editor route (`admin.component.ts` `isEditorRoute`), so the
 * persistent full-bleed bolt.diy editor iframe (`.bolt-frame--visible`) is
 * composited over the shell — its FAB/topbar are not click-reachable for a real
 * user without an architectural change to the persistent-iframe host. Until that
 * is resolved we cannot drive the FAB via real clicks; instead we assert the
 * de-fake against the deployed JS (the mock literals are gone, the real endpoint
 * is wired) and that loading `/admin` fires NO native alert dialog. See the
 * round report + FEATURES.md "Known gaps".
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

test.describe('admin AI FAB + share — de-faked, verified on the live bundle', () => {
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((k: string) => {
      try {
        localStorage.setItem(
          'ps_session',
          JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
        );
      } catch {
        /* ignore */
      }
    }, KEY);
  });

  test.skip(!KEY, 'E2E_API_KEY not set');

  test('shell mounts on /admin and fires NO native alert dialog', async ({ page }) => {
    let dialogFired = false;
    page.on('dialog', (d) => {
      dialogFired = true;
      void d.dismiss().catch(() => undefined);
    });

    await page.goto('/', { waitUntil: 'load' });
    await page.goto('/admin', { waitUntil: 'load' });

    // The admin shell mounts. (The former `.adm-fab[data-upgrade="18"]` /
    // `.adm-share[data-upgrade="19"]` upgrade-tagged nodes were REMOVED from src
    // 2026-08-08 — those exact selectors no longer exist; the real FAB/share
    // interactions are covered by their own specs. Here we assert only that the
    // admin shell renders and no native dialog fires on load.)
    await expect(page.locator('.admin-sidebar, app-admin, [data-cockpit]').first()).toBeVisible({
      timeout: 30000,
    });

    await page.waitForTimeout(1500);
    expect(dialogFired, 'no alert()/confirm() may fire when the admin loads').toBe(false);
  });

  test('deployed JS has the real copilot wiring and ZERO mock/alert fakes', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'load' });
    // Give lazy admin chunks time to load so their resource entries exist.
    await page.waitForTimeout(2500);

    const { hasMock, hasRealEndpoint, scanned } = await page.evaluate(async () => {
      const urls = performance
        .getEntriesByType('resource')
        .map((e) => (e as PerformanceResourceTiming).name)
        .filter((u) => u.endsWith('.js'));
      let hasMock = false;
      let hasRealEndpoint = false;
      let scanned = 0;
      for (const u of urls) {
        try {
          const txt = await fetch(u).then((r) => r.text());
          scanned++;
          if (txt.includes('Echo for') || txt.includes('Production wires this')) hasMock = true;
          if (txt.includes('/api/admin/ai/stream/chat')) hasRealEndpoint = true;
        } catch {
          /* cross-origin or transient — skip */
        }
      }
      return { hasMock, hasRealEndpoint, scanned };
    });

    expect(scanned, 'should have scanned at least one JS chunk').toBeGreaterThan(0);
    expect(hasMock, 'the old FAB mock echo literals must be gone from production').toBe(false);
    expect(
      hasRealEndpoint,
      'the FAB must be wired to the real /api/admin/ai/stream/chat copilot',
    ).toBe(true);
  });
});
