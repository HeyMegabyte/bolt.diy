/**
 * @module e2e/admin-interactions
 *
 * Interaction-level TDD sweep. The load-only functional sweep
 * (admin-functional) catches crashes on section MOUNT, but real bugs hide
 * behind clicks — tab switches, modal openers, filter pills. This spec drives
 * those interactions and asserts none crash into the `section-error-boundary`
 * and none log app console errors. Seeds `ps_session` from `E2E_API_KEY`.
 * Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';
const IGNORE = [
  /googletagmanager\.com/i, /google-analytics\.com/i, /posthog/i, /NG0911/i,
  /editor\.projectsites\.dev/i, /Failed to load resource/i, /api\.novu\.co/i,
];
const isAppError = (t: string): boolean => !IGNORE.some((re) => re.test(t));

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try { localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() })); } catch { /* */ }
  }, KEY);
}

/** Click every visible element matching `selector`, asserting no crash after each. */
async function clickEach(page: Page, label: string, selector: string, errs: string[]): Promise<number> {
  const loc = page.locator(selector);
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.click({ timeout: 5000 }).catch(() => { /* non-fatal: some controls toggle others away */ });
    await page.waitForTimeout(350);
    const crashed = await page.locator('[data-testid="section-error-boundary"]').count();
    expect(crashed, `${label}: crashed into error boundary after click #${i}`).toBe(0);
  }
  return n;
}

test.describe('legacy /admin — interaction sweep (clicks must not crash)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');

  test('billing — every tab switches without crashing', async ({ page }) => {
    test.setTimeout(90_000);
    const errs: string[] = [];
    page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error' && isAppError(m.text())) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    await seed(page);
    await page.goto('/admin/billing', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(800);
    // Billing tabs render as buttons/links with these labels.
    const tabs = ['Add-ons', 'Wallet', 'Usage', 'Metering', 'Agency', 'Connect', 'Affiliate', 'Subscription'];
    let clicked = 0;
    for (const t of tabs) {
      const tab = page.getByRole('button', { name: new RegExp(`^${t}`, 'i') }).or(page.getByRole('tab', { name: new RegExp(`^${t}`, 'i') })).first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click().catch(() => {});
        await page.waitForTimeout(450);
        const crashed = await page.locator('[data-testid="section-error-boundary"]').count();
        expect(crashed, `billing: tab "${t}" crashed the section`).toBe(0);
        clicked++;
      }
    }
    expect(clicked, 'at least some billing tabs were exercised').toBeGreaterThan(0);
    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('modal openers + filters across sections do not crash', async ({ page }) => {
    test.setTimeout(180_000);
    const errs: string[] = [];
    page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error' && isAppError(m.text())) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    await seed(page);

    // forms — filter pills
    await page.goto('/admin/forms', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await clickEach(page, 'forms-pills', '.pill, [role="tab"], button:has-text("Today"), button:has-text("Newsletter")', errs);

    // feature-flags — search + first row actions
    await page.goto('/admin/feature-flags', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await clickEach(page, 'flags-actions', 'button:has-text("Inspect")', errs);
    // close any opened dialog
    await page.keyboard.press('Escape').catch(() => {});

    // audit — column filter icons / export should not crash
    await page.goto('/admin/audit', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const auditCrash = await page.locator('[data-testid="section-error-boundary"]').count();
    expect(auditCrash, 'audit mounted without crash').toBe(0);

    // content-freshness — the Spartan toggle-group status filter switches state
    await page.goto('/admin/content-freshness', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const approved = page.locator('[data-testid="cf-filter-approved"]');
    if (await approved.isVisible().catch(() => false)) {
      await approved.click();
      await page.waitForTimeout(400);
      await expect(approved, 'cf toggle reflects the active selection').toHaveClass(/cf-toggle-active/);
      expect(await page.locator('[data-testid="section-error-boundary"]').count(), 'content-freshness toggle did not crash').toBe(0);
    }

    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('primary actions + tabs across more sections do not crash', async ({ page }) => {
    test.setTimeout(180_000);
    const errs: string[] = [];
    page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error' && isAppError(m.text())) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    await seed(page);

    // settings — tab strip (General / Team / Billing / API / Active Sites etc.)
    await page.goto('/admin/settings', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await clickEach(page, 'settings-tabs', '[role="tab"], .settings-tab, button.tab', errs);

    // snapshots — "Create Snapshot" opens a dialog; must not crash
    await page.goto('/admin/snapshots', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const snapBtn = page.getByRole('button', { name: /create snapshot/i }).first();
    if (await snapBtn.isVisible().catch(() => false)) {
      await snapBtn.click().catch(() => {});
      await page.waitForTimeout(500);
      expect(await page.locator('[data-testid="section-error-boundary"]').count(), 'snapshots create did not crash').toBe(0);
      await page.keyboard.press('Escape').catch(() => {});
    }

    // api-tokens — "New Token" opens the create dialog
    await page.goto('/admin/api-tokens', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const tokBtn = page.getByRole('button', { name: /new token/i }).first();
    if (await tokBtn.isVisible().catch(() => false)) {
      await tokBtn.click().catch(() => {});
      await page.waitForTimeout(500);
      expect(await page.locator('[data-testid="section-error-boundary"]').count(), 'api-tokens new-token did not crash').toBe(0);
      await page.keyboard.press('Escape').catch(() => {});
    }

    // domains — mounting + any visible primary buttons
    await page.goto('/admin/domains', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    expect(await page.locator('[data-testid="section-error-boundary"]').count(), 'domains mounted without crash').toBe(0);

    // sites — Web Vitals heatmap; clicking column sorts / triage toggle
    await page.goto('/admin/sites', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await clickEach(page, 'sites-controls', 'th, button:has-text("Triage"), button:has-text("Refresh")', errs);

    expect(errs, errs.join('\n')).toEqual([]);
  });
});
