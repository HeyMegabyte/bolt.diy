/**
 * ADMIN-01 — /admin shell mounts: sidebar + nav items
 * ADMIN-02 — Sidebar nav switches sub-route WITHOUT a full page reload (SPA sentinel)
 * ADMIN-33 — Network-status banner appears offline, clears back online
 * ADMIN-34 — Toast layer dedupes identical toasts + supports action-armed toasts
 *
 * MODERNIZED 2026-07-31 (residual-admin triage). Folds the two still-unique
 * shell behaviors from the deleted admin-gaps.spec.ts (ADMIN-33/34 — the
 * network banner + toast layer had NO other executing coverage; their
 * components live at `components/network-status/` + `components/toast/` and
 * `ToastService` still exposes `window.__toastService`). ADMIN-03 from that
 * file died with the `/admin/sites` list route (routes now only have
 * `sites/:id`). Shell-mount + section journeys are covered by
 * admin-journey.spec.ts + the admin-*-journey suite; what THIS spec owns is
 * the reload-free SPA contract + the two shell-level UX layers.
 *
 * House pattern: authedPage fixture (signInAsTestUser ran inside the fixture);
 * stubs (none needed here — the helper's benign catch-all suffices) come after
 * the helper. Deterministic (locator waits only), parallel-safe (isolated
 * authed context), stable selectors. No inputs on this surface → the
 * value-domain contract is N/A here (covered where inputs exist).
 */

import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('posthog') &&
      !e.includes('sentry') &&
      !e.includes('net::ERR_BLOCKED_BY_CLIENT') &&
      !e.toLowerCase().includes('failed to load resource') &&
      !e.includes('Http failure') &&
      !e.includes('ChunkLoadError') &&
      !e.includes('Loading chunk'),
  );
}

test.describe('ADMIN-01 — /admin shell mounts with sidebar', () => {
  test('sidebar aside + nav items render without console errors', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    expect(page.url()).not.toContain('/signin');

    // The left nav column (aside) + at least one nav-item link.
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('aside a.nav-item').first()).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'e2e/screenshots/admin-shell/01-shell.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });
});

test.describe('ADMIN-02 — SPA nav never full-reloads', () => {
  test('sidebar click navigation preserves the session sentinel', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('aside a.nav-item', { timeout: 20_000 });

    // Inject a sentinel that only survives if no full reload occurs.
    const sentinel = await page.evaluate(() => {
      const v = Math.random();
      (window as unknown as Record<string, unknown>)['_spaSessionId'] = v;
      return v;
    });
    expect(typeof sentinel).toBe('number');

    // Click whatever standalone /admin/<section> nav-item the sidebar ACTUALLY renders —
    // a calm, deterministic SPA-nav target that adapts to the hand-curated nav. (Was
    // hardcoded to /admin/domains reached via a collapsed "More tools" <details>; Domains
    // has since been folded into Settings — app.routes.ts redirects /admin/domains →
    // /admin/settings#domains and that disclosure was removed — so the old assertion was a
    // stale-spec chronic timeout on prod. Reading the rendered nav keeps this stale-proof.
    // Fixed AL-151 2026-09-07.)
    const targetHref = await page
      .locator('aside a.nav-item[href^="/admin/"]')
      .evaluateAll((as) => {
        const hrefs = as
          .map((a) => a.getAttribute('href') || '')
          .filter((h) => /^\/admin\/[a-z]/.test(h) && h !== '/admin/dashboard');
        return hrefs[0] || '';
      });
    expect(targetHref, 'a standalone /admin/<section> nav-item must exist in the sidebar').toBeTruthy();
    const targetPath = new URL(targetHref, BASE).pathname;
    await page.locator(`aside a.nav-item[href="${targetHref}"]`).first().click();
    await page.waitForURL((u) => u.pathname === targetPath, { timeout: 10_000 });

    // Sentinel MUST still exist — a full reload would have wiped it.
    const sentinelAfter = await page.evaluate(
      () => (window as unknown as Record<string, unknown>)['_spaSessionId'],
    );
    expect(sentinelAfter).toBe(sentinel);

    // Shell persisted too (admin component never remounted the document).
    await expect(page.locator('aside').first()).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/admin-shell/02-spa-nav.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });
});

test.describe('ADMIN-33 — network-status banner', () => {
  test('appears on offline event, clears after back-online', async ({ authedPage: page }) => {
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('aside a.nav-item', { timeout: 20_000 });

    // Force offline (the component wires window online/offline events).
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
    });
    const banner = page.getByTestId('network-status-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText(/offline/i);

    await page.screenshot({ path: 'e2e/screenshots/admin-shell/03-offline-banner.png' });

    // Back online → "Back online. Reconnecting…" then the banner clears.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      window.dispatchEvent(new Event('online'));
    });
    await expect(banner).toBeHidden({ timeout: 10_000 });
  });
});

test.describe('ADMIN-34 — toast layer', () => {
  test('dedupes identical toasts and renders action-armed toasts', async ({
    authedPage: page,
  }) => {
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('aside a.nav-item', { timeout: 20_000 });

    // ToastService exposes itself on window (toast.service.ts) — fire two
    // identical info toasts; the dedupe window must render exactly one.
    const exposed = await page.evaluate(() => {
      const toast = (window as unknown as { __toastService?: { info: (m: string) => void } })
        .__toastService;
      if (!toast) return false;
      toast.info('Saved — duplicate filter check');
      toast.info('Saved — duplicate filter check');
      return true;
    });
    expect(exposed, '__toastService must be exposed on window').toBe(true);

    const dupes = page.locator('[data-testid="toast-item"]', {
      hasText: 'duplicate filter check',
    });
    await expect(dupes).toHaveCount(1, { timeout: 5_000 });

    // Action-armed toast renders its action button (role=alert path).
    await page.evaluate(() => {
      const toast = (
        window as unknown as {
          __toastService?: {
            error: (m: string, opts?: { action?: { label: string; onClick: () => void } }) => void;
          };
        }
      ).__toastService;
      toast?.error('Save failed', { action: { label: 'Retry', onClick: () => undefined } });
    });
    await expect(page.getByRole('button', { name: /^Retry$/ })).toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: 'e2e/screenshots/admin-shell/04-toasts.png' });
  });
});
