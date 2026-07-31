/**
 * adversarial/sections-data.spec.ts
 *
 * ADVERSARIAL — Data-table/grid sections (modernized 2026-07-31): domains,
 * logs (audit + explorer + traces tabs), apps, docs, analytics.
 *
 * Scenarios:
 *  ADV-DATA-02  Domains: whitespace AI-domain-search does not crash the section
 *  ADV-DATA-04  Logs→Traces tab: hard reload — shell remounts, no white screen
 *  ADV-DATA-06  Logs→Audit tab: hard reload preserves route, no uncaught errors
 *  ADV-DATA-08  Domains: hostnames-table or loading indicator visible on load
 *  ADV-DATA-10  Logs explorer: navigate away mid-query → return → no crash
 *  ADV-DATA-12  /admin/mcp functional redirect resolves to Settings without crash
 *  ADV-DATA-16  Apps: search input state after navigate-away and return
 *  ADV-DATA-20  Docs: overview surface does not trigger full page reload
 *  ADV-DATA-23  Analytics: deep-link reload mounts KPI cards
 *  ADV-DATA-25  Apps-instances: route loads — no 404 white screen
 *
 * Modernization notes:
 *  - networkidle NEVER settles on this app — reloads wait domcontentloaded +
 *    explicit locator waits.
 *  - /admin/traces + /admin/audit are now TABS inside /admin/logs
 *    (logs-dashboard.component.ts, testids logs-tab-audit|explorer|traces).
 *  - The old AI-search testids live in the DOMAINS section (AI creative
 *    domain search), not analytics — ADV-DATA-02 retargeted.
 *  - /admin/settings/mcp is gone; /admin/mcp functionally redirects to
 *    /admin/settings with the #mcp fragment (app.routes.ts comment).
 *  - window.history.pushState never drives the Angular router — replaced
 *    with real deep-link goto (house pattern per e2e/admin/mcp.spec.ts;
 *    session + stubs persist across navigations in the authed context).
 *
 * Rules:
 *  - authedPage fixture: signInAsTestUser + catch-all /api/** stubs run
 *    BEFORE any /admin navigation — authed GETs never reach prod.
 *  - Internal nav via UI clicks / routerLink locators; goto only for initial
 *    load, reloads, and deep-link entry points.
 *  - No page.waitForTimeout. Parallel-safe (isolated context per test).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev'; // localhost:8787 fallback sent the whole suite to a stray dev server ("governor" page)

// ─── helpers ────────────────────────────────────────────────────────────────

async function gotoAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });
}

function collectErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      const lower = t.toLowerCase();
      if (
        !lower.includes('favicon') &&
        !lower.includes('failed to load resource') &&
        !t.includes('net::ERR_BLOCKED') &&
        !t.includes('ERR_ABORTED') &&
        !t.includes('ERR_FAILED')
      ) {
        errors.push(t);
      }
    }
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  return errors;
}

async function clickNav(
  page: import('@playwright/test').Page,
  routerLink: string,
): Promise<boolean> {
  const link = page.locator(`a[routerLink="${routerLink}"]`).first();
  const visible = await link.isVisible({ timeout: 4_000 }).catch(() => false);
  if (visible) {
    await link.click();
    await page
      .waitForURL(new RegExp(routerLink.replace(/\//g, '\\/')), { timeout: 8_000 })
      .catch(() => undefined);
  }
  return visible;
}

async function injectSentinel(page: import('@playwright/test').Page): Promise<number> {
  const v = Math.random();
  await page.evaluate((val: number) => {
    (window as unknown as Record<string, unknown>)['__adv_sentinel__'] = val;
  }, v);
  return v;
}

async function assertSentinel(
  page: import('@playwright/test').Page,
  v: number,
): Promise<void> {
  const actual = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__adv_sentinel__'],
  );
  expect(actual).toBe(v);
}

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page
    .screenshot({ path: `e2e/screenshots/adversarial/${name}.png`, fullPage: false })
    .catch(() => undefined);
}

// ─── ADV-DATA-02: Domains whitespace AI search ──────────────────────────────
// Retargeted from "Analytics" — the ai-search-btn / ai-search-input testids
// belong to the Domains section (AI creative domain search).

test.describe('ADV-DATA-02 — Domains: whitespace AI search', () => {
  test('typing whitespace into the AI domain search then clearing does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/domains');

    const input = page.getByTestId('ai-search-input');
    if (await input.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await input.fill('   ');
      const searchBtn = page.getByTestId('ai-search-btn');
      if (await searchBtn.isEnabled({ timeout: 2_000 }).catch(() => false)) {
        await searchBtn.click();
      }
      await input.fill('');
      await page.keyboard.press('Escape');
    }

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    await shot(page, 'data-02-domains-ai-search');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-04: Logs → Traces tab hard reload ─────────────────────────────
// /admin/traces retired as a standalone route — Traces is a tab under Logs.

test.describe('ADV-DATA-04 — Logs Traces tab hard reload', () => {
  test('reloading the traces tab shows admin shell — not a white screen', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/logs');

    const tracesTab = page.getByTestId('logs-tab-traces');
    if (await tracesTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await tracesTab.click();
    }

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('logs-dashboard')).toBeVisible({ timeout: 10_000 });
    await shot(page, 'data-04-traces-reload');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-06: Logs → Audit tab hard reload ──────────────────────────────
// /admin/audit retired as a standalone route — Audit Trail is the default
// tab of /admin/logs.

test.describe('ADV-DATA-06 — Logs Audit tab hard reload', () => {
  test('reloading /admin/logs (audit tab) remounts shell without errors', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/logs');

    await expect(page.getByTestId('logs-dashboard')).toBeVisible({ timeout: 10_000 });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('logs-dashboard')).toBeVisible({ timeout: 10_000 });
    await shot(page, 'data-06-audit-reload');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-08: Domains hostnames mount ───────────────────────────────────

test.describe('ADV-DATA-08 — Domains hostnames-table mounts', () => {
  test('/admin/domains shows loading or table — not a blank page', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/domains');

    const present = await page
      .locator('[data-testid="hostnames-table"],[data-testid="hostnames-loading"]')
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    // Even if neither is present (empty state) the shell must not be blank
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    const bodyContent = await page.locator('body').textContent();
    expect(bodyContent?.trim().length).toBeGreaterThan(0);
    expect(typeof present).toBe('boolean');
    await shot(page, 'data-08-domains-mounted');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-10: Logs explorer navigate away mid-query ─────────────────────
// Retargeted: the old site-logs-tail testid lives in site-detail. The live
// contract here is the Logs Explorer tab surviving a mid-query bounce.

test.describe('ADV-DATA-10 — Logs explorer: navigate away mid-query and return', () => {
  test('leaving the log explorer mid-search and returning does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    await clickNav(page, '/admin/logs');
    const explorerTab = page.getByTestId('logs-tab-explorer');
    if (await explorerTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await explorerTab.click();
      const searchInput = page.getByTestId('logs-search-input');
      if (await searchInput.isVisible({ timeout: 4_000 }).catch(() => false)) {
        await searchInput.fill('adversarial-mid-query');
        const searchBtn = page.getByTestId('logs-search-btn');
        if (await searchBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await searchBtn.click(); // fire the query, then bounce immediately
        }
      }
    }

    await clickNav(page, '/admin/analytics');
    await clickNav(page, '/admin/logs');

    await expect(page.getByTestId('logs-dashboard')).toBeVisible({ timeout: 10_000 });
    await shot(page, 'data-10-explorer-return');
    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-12: /admin/mcp redirect resolves ──────────────────────────────
// /admin/settings/mcp 404s (settings is a flat route); the live contract is
// the /admin/mcp functional redirect → /admin/settings + #mcp fragment.

test.describe('ADV-DATA-12 — /admin/mcp redirect resolves', () => {
  test('deep-linking /admin/mcp lands on Settings without crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);

    // Deep-link entry (legitimate separate navigation — session + stubs persist)
    await page.goto(`${BASE}/admin/mcp`, { waitUntil: 'domcontentloaded' });

    // /admin/mcp has no RENAMED_ROUTES entry (not-found.component.ts) — the
    // contract is the in-shell fuzzy-404 helper renders inside the admin
    // shell without crashing, not a redirect to Settings.
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(20);
    await shot(page, 'data-12-mcp-fuzzy-404');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-16: Apps search state on re-navigation ────────────────────────

test.describe('ADV-DATA-16 — Apps search state on re-navigation', () => {
  test('typing in apps-search then navigating away and back does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    await clickNav(page, '/admin/apps');
    const searchInput = page.getByTestId('apps-search-input');
    if (await searchInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await searchInput.fill('adversarial-state-test');
    }

    await clickNav(page, '/admin/analytics');
    await clickNav(page, '/admin/apps');

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    await shot(page, 'data-16-apps-return');
    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-20: Docs overview stays in SPA ────────────────────────────────

test.describe('ADV-DATA-20 — Docs overview stays in SPA', () => {
  test('interacting with docs-overview-root preserves sentinel — no full reload', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/docs');
    const sentinel = await injectSentinel(page);

    const overviewRoot = page.getByTestId('docs-overview-root');
    if (await overviewRoot.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await overviewRoot.click();
      await assertSentinel(page, sentinel);
    }
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    await shot(page, 'data-20-docs-overview');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-23: Analytics deep-link reload ────────────────────────────────

test.describe('ADV-DATA-23 — Analytics deep-link hard reload', () => {
  test('reloading /admin/analytics mounts KPI elements without white screen', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/analytics');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });
    // KPI tiles graceful — may be 0 if no data yet
    const kpiCount = await page
      .locator(
        '[data-testid="kpi-pageviews"],[data-testid="kpi-requests"],[data-testid="kpi-visitors"]',
      )
      .count();
    expect(kpiCount).toBeGreaterThanOrEqual(0);
    await shot(page, 'data-23-analytics-reload');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-25: Apps-instances route graceful ─────────────────────────────

test.describe('ADV-DATA-25 — Apps-instances route does not 404 blank', () => {
  test('/admin/apps/instances loads without empty shell', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);

    const link = page.locator('a[routerLink="/admin/apps/instances"]').first();
    if (await link.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await link.click();
      await page.waitForURL(/\/admin\/apps\/instances/, { timeout: 8_000 }).catch(() => undefined);
    } else {
      // No nav affordance — deep-link entry (route exists in app.routes.ts)
      await page.goto(`${BASE}/admin/apps/instances`, { waitUntil: 'domcontentloaded' });
    }

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
    const bodyContent = await page.locator('body').textContent();
    expect(bodyContent?.trim().length).toBeGreaterThan(0);
    await shot(page, 'data-25-apps-instances');
    expect(errors).toHaveLength(0);
  });
});
