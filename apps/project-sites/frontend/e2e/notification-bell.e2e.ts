/**
 * @module e2e/notification-bell
 *
 * The admin notification bell renders the LOCAL feed and makes ZERO external
 * notification-vendor calls. HISTORY: this spec once asserted the bell wired
 * Novu Cloud (`api.novu.co/v1/inbox`) as an additive source. Novu was fully
 * decommissioned per ADR-0034 (→ custom `psnotify`); `NovuInboxService` is now
 * an INERT shim (`connected=false`, `list()→[]`, zero network I/O — see
 * src/app/services/novu-inbox.service.ts). The old assertion
 * (`novuReqs.length > 0`) is therefore deterministically red. Rewritten
 * 2026-08-09 to LOCK IN the decommission instead of a phantom integration: the
 * bell opens, renders the local `/api/notifications` feed (`.notif-pop`), fires
 * NO `api.novu.co` request, opens via SPA (no full reload), and stays
 * console-error-free. If anyone re-wires Novu, the zero-calls assertion catches
 * it. Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
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
  /api\.novu\.co/i,
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

test.describe('admin notification bell — local feed, Novu-free (ADR-0034)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('bell opens, renders the local feed, makes zero Novu calls, stays clean', async ({ page }) => {
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
    // Disclosure a11y (WCAG 4.1.2): collapsed before open (axe can't detect this).
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
    await bell.click();

    // local feed surface still renders (no regression) — the audit/seed feed
    // populates the popover even when the inbox is empty. Scope to the
    // notifications popover specifically: the site-actions dropdown reuses the
    // `.notif-pop` class (`.notif-pop.site-actions-pop`), so exclude it.
    await expect(page.locator('.notif-pop:not(.site-actions-pop)').first()).toBeVisible({ timeout: 10000 });

    // Disclosure a11y (WCAG 4.1.2): expanded once the popover is open.
    await expect(bell, 'bell must expose aria-expanded=true when open').toHaveAttribute('aria-expanded', 'true');

    // Settle: the old Novu client fired its inbox session on admin boot + bell
    // open. Give any (regressed) Novu call a generous window to appear BEFORE we
    // assert zero — so this is a real no-I/O proof, not a race.
    await page.waitForTimeout(2500);

    // Novu is decommissioned (ADR-0034) — the inert shim does ZERO network I/O.
    // The bell must make NO api.novu.co request. A non-empty list here means
    // someone re-wired Novu Cloud; fail so we notice.
    expect(novuReqs.length, `Novu is decommissioned (ADR-0034) — expected 0 api.novu.co calls, got: ${novuReqs.join(', ') || 'none'}`).toBe(0);

    // clean: no app console errors, no uncaught errors, no full reload
    const reloaded = await page.evaluate(() => (window as unknown as { __reloaded?: boolean }).__reloaded === true);
    expect(reloaded, 'no full reload when opening the bell').toBe(false);
    const navEntries = await page.evaluate(() => performance.getEntriesByType('navigation').length);
    expect(navEntries, 'no full reload occurred').toBe(1);
    expect(errs, errs.join('\n')).toEqual([]);
  });
});
