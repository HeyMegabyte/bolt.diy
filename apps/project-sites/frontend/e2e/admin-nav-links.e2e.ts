/**
 * admin-nav-links.e2e.ts — the left-nav exposes clickable, SPA-navigable section links
 *
 * HISTORY: this spec originally hard-asserted five specific "orphaned" sections
 * (Marketplace, Enterprise, Trust Center, Stripe App, Features Hub). Those
 * sections were DELETED (no route/component in src), so the hardcoded list went
 * stale and the spec red-noised. Rewritten 2026-08-09 to guard the DURABLE
 * contract instead of a drift-prone section list: the admin left-nav must expose
 * multiple clickable links that navigate via the SPA router (nav stays mounted →
 * no full reload), and the aria-live announcer must update on section change —
 * WITHOUT naming any specific (deletable) section. Per-section discoverability +
 * a11y is covered by admin-a11y.e2e.ts, which iterates the live section set.
 *
 * Seeds `ps_session` from `E2E_API_KEY` (a real `psk_test_` key row in prod D1).
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts admin-nav-links
 */

import { test, expect, type Locator } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

/** A real top-level admin SECTION link (`/admin/<slug>`), not the dashboard,
 * the bolt-iframe editor host, or a deep param route. */
async function sectionHref(link: Locator): Promise<string | null> {
  const href = (await link.getAttribute('href')) ?? '';
  if (!/^\/admin\/[a-z][a-z-]*$/.test(href)) return null; // must be /admin/<slug>
  if (href === '/admin/editor') return null; // editor hosts the persistent iframe
  return href;
}

test.describe('admin left-nav — clickable, SPA-navigable section links', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((k: string) => {
      try {
        localStorage.setItem(
          'ps_session',
          JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
        );
        localStorage.setItem('ps_feedback_dismissed', 'true');
      } catch {
        /* localStorage unavailable — test.skip below covers the no-key path */
      }
    }, KEY);
  });

  test.skip(!KEY, 'E2E_API_KEY not set');

  test('the left-nav exposes clickable section links that navigate via the SPA router', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/admin');
    const nav = page.locator('nav[aria-label="Admin sections"]');
    await expect(nav).toBeVisible({ timeout: 15_000 });

    // The nav surfaces MULTIPLE section links (discoverable, not URL-only).
    const links = nav.getByRole('link');
    const count = await links.count();
    expect(count, 'the admin nav must expose multiple section links').toBeGreaterThan(3);

    // Real-user navigation: click the first 3 DISTINCT `/admin/<slug>` links and
    // assert each lands on its section via SPA nav (nav stays mounted → no reload).
    const seen = new Set<string>();
    let navigated = 0;
    for (let i = 0; i < count && navigated < 3; i++) {
      const link = links.nth(i);
      const href = await sectionHref(link);
      if (!href || seen.has(href)) continue;
      seen.add(href);
      await link.click();
      await expect(page, `clicking ${href} navigates there`).toHaveURL(
        new RegExp(`${href.replace(/[/]/g, '\\/')}(\\?|$)`),
        { timeout: 10_000 },
      );
      await expect(nav, 'nav stays mounted → SPA navigation, no full reload').toBeVisible();
      navigated++;
    }
    expect(navigated, 'clicked + verified ≥3 SPA section navigations').toBeGreaterThanOrEqual(3);

    // Tolerate flag-gated 404s (feature-flag doctrine: gated reads 404 by design)
    // + favicon/blocked; fail on real JS / CSP / Trusted-Types errors.
    const fatal = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('net::ERR_BLOCKED') &&
        !/Failed to load resource: the server responded with a status of 404/.test(e),
    );
    expect(fatal, `unexpected console errors:\n${fatal.join('\n')}`).toHaveLength(0);
  });

  // SPA route announcer (WCAG 4.1.3): a visually-hidden aria-live region must
  // announce the section name on client-side nav so screen-reader users know the
  // content changed (document-title changes alone are unreliably announced).
  test('the aria-live route announcer updates as the section changes', async ({ page }) => {
    await page.goto('/admin');
    const announcer = page.locator('[data-testid="admin-route-announcer"]');
    // sr-only → not "visible", but attached with live text.
    await expect(announcer).toBeAttached({ timeout: 15_000 });
    expect(announcer).toHaveAttribute('aria-live', 'polite');

    const nav = page.locator('nav[aria-label="Admin sections"]');
    const links = nav.getByRole('link');
    const count = await links.count();

    // Navigate two DISTINCT sections; the announcement must CHANGE (not stay stale).
    let firstText = '';
    let done = 0;
    for (let i = 0; i < count && done < 2; i++) {
      const href = await sectionHref(links.nth(i));
      if (!href) continue;
      await links.nth(i).click();
      await expect(page).toHaveURL(new RegExp(`${href.replace(/[/]/g, '\\/')}(\\?|$)`), {
        timeout: 10_000,
      });
      if (done === 0) {
        await expect(announcer).toContainText(/\w/, { timeout: 10_000 });
        firstText = (await announcer.textContent())?.trim() ?? '';
      } else {
        await expect
          .poll(async () => (await announcer.textContent())?.trim(), { timeout: 10_000 })
          .not.toBe(firstText);
      }
      done++;
    }
    expect(done, 'navigated two distinct sections to compare the announcement').toBe(2);
  });
});
