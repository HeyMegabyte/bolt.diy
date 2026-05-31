/**
 * @module e2e/notification-bell
 *
 * TDD for wiring Novu Cloud into the admin notification bell as an ADDITIVE
 * source (the doctrine notification backbone). Guarantees: the bell still opens
 * + renders the local `/api/notifications` feed (no regression), AND the bell
 * connects to Novu Cloud (`api.novu.co/v1/inbox`) via headless `@novu/js` with
 * the PUBLIC application identifier. Every Novu call must be swallowed → zero
 * app console errors, zero uncaught pageerrors, no full reload. Seeds
 * `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';
const IGNORE = [
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /posthog/i,
  /NG0911/i,
  /editor\.projectsites\.dev/i,
  /Failed to load resource/i,
];
const isAppError = (t: string): boolean => !IGNORE.some((re) => re.test(t));

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
    } catch {
      /* private mode */
    }
  }, KEY);
}

test.describe('admin notification bell — Novu-backed + local feed', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');

  test('bell opens, keeps the local feed, connects to Novu Cloud, stays clean', async ({ page }) => {
    test.setTimeout(120_000);
    const errs: string[] = [];
    const novuReqs: string[] = [];
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error' && isAppError(m.text())) errs.push(m.text());
    });
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    page.on('request', (r) => {
      if (/api\.novu\.co/i.test(r.url())) novuReqs.push(r.url().replace(/^https?:\/\/[^/]+/, ''));
    });

    await seed(page);
    await page.goto('/admin', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 20000 });

    // arm reload tripwire
    await page.evaluate(() => {
      (window as unknown as { __reloaded?: boolean }).__reloaded = false;
      window.addEventListener('beforeunload', () => ((window as unknown as { __reloaded?: boolean }).__reloaded = true));
    });

    // open the admin topbar bell (bespoke inline bell — `.notif-pop` dropdown)
    const bell = page.locator('button[aria-label="Notifications"]').first();
    await expect(bell).toBeVisible({ timeout: 15000 });
    await bell.click();

    // local feed surface still renders (no regression) — the audit/seed feed
    // populates the popover even when Novu is empty
    await expect(page.locator('.notif-pop')).toBeVisible({ timeout: 10000 });

    // give Novu's headless client time to open its inbox session (fired on init)
    await page.waitForTimeout(2500);

    // Novu Cloud was contacted (the bell is Novu-backed)
    expect(novuReqs.length, `expected ≥1 api.novu.co/v1/inbox call, got: ${novuReqs.join(', ') || 'none'}`).toBeGreaterThan(0);

    // clean: no app console errors, no uncaught errors, no full reload
    const reloaded = await page.evaluate(() => (window as unknown as { __reloaded?: boolean }).__reloaded === true);
    expect(reloaded, 'no full reload when opening the bell').toBe(false);
    const navEntries = await page.evaluate(() => performance.getEntriesByType('navigation').length);
    expect(navEntries, 'no full reload occurred').toBe(1);
    expect(errs, errs.join('\n')).toEqual([]);
  });
});
