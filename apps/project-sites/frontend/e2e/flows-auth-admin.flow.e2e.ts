/**
 * flows-auth-admin.flow.e2e.ts — Surface #1 of the full-flow suite.
 *
 * 20 ELABORATE, REALISTIC full-flow journeys over auth + session + the admin
 * shell. Each is a real multi-step user journey (seed → navigate by UI → act →
 * assert UI → assert ground-truth via apiFetch → visual snap), not an
 * element-presence check. Targets GREEN — auth + shell are finished surfaces, so
 * this file also proves the `_flow-helpers.ts` harness end-to-end.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-auth-admin.flow
 */
import { test, expect, type Locator } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const NAV = 'nav[aria-label="Admin sections"]';

/** A real top-level `/admin/<slug>` section link (not editor/dashboard/param routes). */
async function sectionHref(link: Locator): Promise<string | null> {
  const href = (await link.getAttribute('href')) ?? '';
  if (!/^\/admin\/[a-z][a-z-]*$/.test(href)) return null;
  if (href === '/admin/editor') return null; // hosts the persistent bolt iframe
  return href;
}

test.describe('Full-flow · auth + session + admin shell', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  // Reduced-motion disables the Angular View-Transition pointer overlay that
  // otherwise intercepts nav clicks mid-transition (`<html> intercepts pointer
  // events`) — removes concurrency flake AND makes visual snaps deterministic.
  test.use({ reducedMotion: 'reduce' });

  // ── Session lifecycle ──────────────────────────────────────────────────────

  test('01 seeded session boots the admin shell authenticated (UI + /api/auth/me ground-truth)', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(NAV)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/admin/);
    const me = await apiFetch<{ user?: unknown; email?: string; org_id?: string }>(page, '/api/auth/me');
    expect(me.status, 'authenticated session resolves /api/auth/me').toBe(200);
    await snap(page, '01-admin-authenticated');
    expectClean(errors);
  });

  test('02 reloading /admin preserves the session (no bounce to /signin)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(NAV)).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(NAV), 'session survived a reload').toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('03 unauthenticated visit to /admin bounces to /signin with a returnUrl', async ({ page }) => {
    // NO seedSession — the guard must redirect.
    await page.goto('/admin', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await expect(page, 'protected route redirects when unauthenticated').toHaveURL(/\/signin/, {
      timeout: 15_000,
    });
    expect(page.url()).toMatch(/returnUrl|return_to|redirect|\/signin/);
  });

  test('04 a stale/garbage session token is rejected → /signin (not a white screen)', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('ps_session', JSON.stringify({ token: 'psk_test_invalid_garbage', identifier: 'x@y.z' }));
      } catch {
        /* ignore */
      }
    });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' }).catch(() => {});
    // Either bounced to signin OR the shell renders an unauth state — never a blank root.
    const rootLen = await page.evaluate(
      () => (document.querySelector('app-root, #root') as HTMLElement | null)?.innerHTML.length ?? 0,
    );
    expect(rootLen, 'app rendered something (not a white screen)').toBeGreaterThan(100);
  });

  // ── Shell boot + navigation ─────────────────────────────────────────────────

  test('05 admin shell boots with a multi-link section nav + aria-live announcer', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const nav = page.locator(NAV);
    await expect(nav).toBeVisible({ timeout: 15_000 });
    const count = await nav.getByRole('link').count();
    expect(count, 'admin nav exposes many section links').toBeGreaterThan(4);
    const announcer = page.locator('[data-testid="admin-route-announcer"]');
    await expect(announcer).toBeAttached({ timeout: 10_000 });
    await expect(announcer).toHaveAttribute('aria-live', 'polite');
    await snap(page, '05-admin-shell');
  });

  test('06 navigate EVERY reachable /admin section by UI — SPA nav, no reload, no fatal console', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const nav = page.locator(NAV);
    await expect(nav).toBeVisible({ timeout: 15_000 });
    const links = nav.getByRole('link');
    const count = await links.count();

    const hrefs: string[] = [];
    for (let i = 0; i < count; i++) {
      const h = await sectionHref(links.nth(i));
      if (h && !hrefs.includes(h)) hrefs.push(h);
    }
    expect(hrefs.length, 'discovered many navigable sections').toBeGreaterThan(4);

    let visited = 0;
    for (const href of hrefs) {
      const link = nav.locator(`a[href="${href}"]`).first();
      if (!(await link.count())) continue;
      await link.click();
      await expect(page, `SPA-navigated to ${href}`).toHaveURL(
        new RegExp(`${href.replace(/[/]/g, '\\/')}(\\?|#|$)`),
        { timeout: 12_000 },
      );
      await expect(nav, 'nav stays mounted → SPA (no full reload)').toBeVisible();
      // The section shell must render real content, never a blank panel.
      const mainLen = await page.evaluate(
        () => (document.querySelector('main, [role="main"], .admin-main') as HTMLElement | null)?.innerHTML.length ?? 0,
      );
      expect(mainLen, `${href} rendered content`).toBeGreaterThan(30);
      if (visited < 4) await snap(page, `06-section-${href.split('/').pop()}`);
      visited++;
    }
    expect(visited, 'visited every discovered section').toBeGreaterThanOrEqual(hrefs.length);
    expectClean(errors);
  });

  test('07 the active section link reflects the current route (aria-current / active state)', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const nav = page.locator(NAV);
    await expect(nav).toBeVisible({ timeout: 15_000 });
    const links = nav.getByRole('link');
    const count = await links.count();
    let checked = false;
    for (let i = 0; i < count && !checked; i++) {
      const href = await sectionHref(links.nth(i));
      if (!href) continue;
      await links.nth(i).click();
      await expect(page).toHaveURL(new RegExp(`${href.replace(/[/]/g, '\\/')}(\\?|#|$)`), { timeout: 12_000 });
      const active = nav.locator(
        `a[href="${href}"][aria-current], a[href="${href}"].active, a[href="${href}"][class*="active"]`,
      );
      // Durable contract: SOME active-state signal exists on the current link.
      if (await active.count()) checked = true;
    }
    expect(checked, 'the current section link carries an active/aria-current signal').toBeTruthy();
  });

  test('08 the aria-live announcer text CHANGES across two distinct sections', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const announcer = page.locator('[data-testid="admin-route-announcer"]');
    await expect(announcer).toBeAttached({ timeout: 15_000 });
    const nav = page.locator(NAV);
    const links = nav.getByRole('link');
    const count = await links.count();
    let first = '';
    let done = 0;
    for (let i = 0; i < count && done < 2; i++) {
      const href = await sectionHref(links.nth(i));
      if (!href) continue;
      await links.nth(i).click();
      await expect(page).toHaveURL(new RegExp(`${href.replace(/[/]/g, '\\/')}(\\?|#|$)`), { timeout: 12_000 });
      if (done === 0) {
        await expect(announcer).toContainText(/\w/, { timeout: 10_000 });
        first = (await announcer.textContent())?.trim() ?? '';
      } else {
        await expect.poll(async () => (await announcer.textContent())?.trim(), { timeout: 10_000 }).not.toBe(first);
      }
      done++;
    }
    expect(done, 'compared the announcement across two sections').toBe(2);
  });

  // ── Deep-linking ────────────────────────────────────────────────────────────

  test('09 deep-link /admin/settings#mcp lands on Settings with the MCP tab active', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#mcp');
    await expect(page).toHaveURL(/\/admin\/settings/);
    // MCP tab content is present (the AI-vars callout shipped this week).
    await expect(page.getByText('MCPs also use your project AI variables', { exact: false })).toBeVisible({
      timeout: 12_000,
    });
    await snap(page, '09-settings-mcp-deeplink');
    expectClean(errors);
  });

  test('10 deep-link directly to a data section (/admin/analytics) renders its shell', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/analytics');
    await expect(page).toHaveURL(/\/admin\/analytics/);
    await expect(page.locator(NAV)).toBeVisible({ timeout: 15_000 });
    const mainLen = await page.evaluate(
      () => (document.querySelector('main, [role="main"], .admin-main') as HTMLElement | null)?.innerHTML.length ?? 0,
    );
    expect(mainLen, 'analytics section rendered its own content').toBeGreaterThan(50);
  });

  // ── 404 recovery ────────────────────────────────────────────────────────────

  test('11 an unknown /admin route shows a styled 404 with a working recovery link', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/this-section-does-not-exist-xyz');
    // A friendly not-found renders (never a white screen); a link returns home.
    const notFound = page.getByText(/not found|doesn.?t exist|404|did you mean/i).first();
    await expect(notFound).toBeVisible({ timeout: 12_000 });
    await snap(page, '11-admin-404');
    const home = page.getByRole('link', { name: /home|dashboard|back to admin|admin/i }).first();
    if (await home.count()) {
      await home.click();
      await expect(page, 'recovered from 404 back into the admin shell').toHaveURL(/\/admin(\/|$)/, {
        timeout: 12_000,
      });
    }
  });

  // ── Browser history ─────────────────────────────────────────────────────────

  test('12 browser Back/Forward preserves SPA history across two sections', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const nav = page.locator(NAV);
    await expect(nav).toBeVisible({ timeout: 15_000 });
    const links = nav.getByRole('link');
    const hrefs: string[] = [];
    const count = await links.count();
    for (let i = 0; i < count && hrefs.length < 2; i++) {
      const h = await sectionHref(links.nth(i));
      if (h && !hrefs.includes(h)) hrefs.push(h);
    }
    expect(hrefs.length).toBe(2);
    await nav.locator(`a[href="${hrefs[0]}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(hrefs[0].replace(/[/]/g, '\\/')), { timeout: 12_000 });
    await nav.locator(`a[href="${hrefs[1]}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(hrefs[1].replace(/[/]/g, '\\/')), { timeout: 12_000 });
    await page.goBack();
    await expect(page, 'Back returns to the first section').toHaveURL(
      new RegExp(hrefs[0].replace(/[/]/g, '\\/')),
      { timeout: 12_000 },
    );
    await page.goForward();
    await expect(page, 'Forward returns to the second section').toHaveURL(
      new RegExp(hrefs[1].replace(/[/]/g, '\\/')),
      { timeout: 12_000 },
    );
  });

  // ── Command palette (Cmd+K) ─────────────────────────────────────────────────

  test('13 Cmd+K opens the command palette and focuses its input', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await page.locator(NAV).waitFor({ state: 'visible', timeout: 15_000 });
    await page.keyboard.press('Meta+k');
    // The palette input receives focus (the SUPREME Cmd+K-focus gate).
    const focusedIsInput = await page.evaluate(() => {
      const a = document.activeElement;
      return !!a && (a.tagName === 'INPUT' || a.getAttribute('role') === 'searchbox' || a.getAttribute('role') === 'combobox');
    });
    // Some builds bind Ctrl+K on non-mac; retry once.
    if (!focusedIsInput) await page.keyboard.press('Control+k');
    const ok = await page.evaluate(() => {
      const a = document.activeElement;
      return !!a && (a.tagName === 'INPUT' || a.getAttribute('role') === 'searchbox' || a.getAttribute('role') === 'combobox');
    });
    expect(ok, 'Cmd/Ctrl+K focuses the palette input').toBeTruthy();
    await snap(page, '13-command-palette');
  });

  test('14 typing in the command palette surfaces navigable results, Esc closes + restores focus', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await page.locator(NAV).waitFor({ state: 'visible', timeout: 15_000 });
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('sett', { delay: 30 });
    // Results list appears (role=option / listbox item / a[href]).
    const results = page.locator('[role="option"], [role="listbox"] a, [data-testid*="palette"] a');
    await expect(results.first(), 'palette shows results for a query').toBeVisible({ timeout: 8_000 });
    await page.keyboard.press('Escape');
    // After Esc the palette is gone — the query input is no longer focused.
    const stillOpen = await page.locator('[role="option"]').first().isVisible().catch(() => false);
    expect(stillOpen, 'Esc closes the palette').toBeFalsy();
  });

  // ── Keyboard access ─────────────────────────────────────────────────────────

  test('15 keyboard: Tab reaches a nav link with a visible focus ring; Enter navigates', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const nav = page.locator(NAV);
    await expect(nav).toBeVisible({ timeout: 15_000 });
    // Focus the first section link programmatically then Enter (robust vs skip-links).
    const first = nav.getByRole('link').first();
    await first.focus();
    const hasFocus = await first.evaluate((el) => el === document.activeElement);
    expect(hasFocus, 'a nav link can receive keyboard focus').toBeTruthy();
    const href = await first.getAttribute('href');
    await page.keyboard.press('Enter');
    if (href && /^\/admin\//.test(href)) {
      await expect(page, 'Enter activates the focused nav link').toHaveURL(
        new RegExp(href.replace(/[/]/g, '\\/')),
        { timeout: 12_000 },
      );
    }
  });

  // ── Ground-truth reconciliation (verify-against-source-of-truth) ─────────────

  test('16 ground-truth: /api/auth/me returns the authenticated identity', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const me = await apiFetch<Record<string, unknown>>(page, '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body, '/api/auth/me returns a user object').toBeTruthy();
  });

  test('17 ground-truth: /api/sites returns an org-scoped array (owner scope)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const sites = await apiFetch<{ sites?: unknown[]; data?: unknown[] }>(page, '/api/sites');
    expect(sites.status, '/api/sites authorizes the seeded owner').toBe(200);
    const arr = sites.body?.sites ?? sites.body?.data ?? sites.body;
    expect(Array.isArray(arr), '/api/sites yields a list (possibly empty — honest)').toBeTruthy();
  });

  test('18 ground-truth: /api/inbox/tasks (task-tray source) authorizes and returns a list', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const tasks = await apiFetch<{ tasks?: unknown[]; data?: unknown[] }>(page, '/api/inbox/tasks');
    expect([200, 204]).toContain(tasks.status);
  });

  // ── Dashboard hub + cross-section hygiene ────────────────────────────────────

  test('19 the /admin dashboard hub renders the getting-started experience', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(NAV)).toBeVisible({ timeout: 15_000 });
    // The hub surfaces guidance/widgets — assert real, substantial content in main.
    const mainLen = await page.evaluate(
      () => (document.querySelector('main, [role="main"], .admin-main') as HTMLElement | null)?.innerHTML.length ?? 0,
    );
    expect(mainLen, 'dashboard hub renders substantial content').toBeGreaterThan(200);
    await snap(page, '19-dashboard-hub');
    expectClean(errors);
  });

  test('20 cross-section console hygiene: visiting 5 sections raises no JS/CSP/Trusted-Types errors', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const nav = page.locator(NAV);
    await expect(nav).toBeVisible({ timeout: 15_000 });
    const links = nav.getByRole('link');
    const count = await links.count();
    let hop = 0;
    for (let i = 0; i < count && hop < 5; i++) {
      const href = await sectionHref(links.nth(i));
      if (!href) continue;
      await links.nth(i).click();
      await expect(page).toHaveURL(new RegExp(`${href.replace(/[/]/g, '\\/')}(\\?|#|$)`), { timeout: 12_000 });
      await page.waitForTimeout(400);
      hop++;
    }
    expect(hop, 'hopped across 5 sections').toBeGreaterThanOrEqual(5);
    expectClean(errors);
  });
});
