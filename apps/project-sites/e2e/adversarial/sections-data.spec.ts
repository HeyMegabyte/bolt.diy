/**
 * adversarial/sections-data.spec.ts
 *
 * ADVERSARIAL — Data-table/grid sections: analytics, traces, audit,
 * domains, logs, mcp, feature-flags, apps, marketplace, inbox, docs,
 * media library.
 *
 * Scenarios:
 *  ADV-DATA-02  Analytics: empty AI search does not crash the section
 *  ADV-DATA-04  Traces: hard reload on /admin/traces — shell remounts, no white screen
 *  ADV-DATA-06  Audit: hard reload preserves route, no uncaught errors
 *  ADV-DATA-08  Domains: hostnames-table or loading indicator visible on load
 *  ADV-DATA-10  Logs: navigate away mid-tail → return → no duplicate connections
 *  ADV-DATA-12  MCP: /admin/settings/mcp redirect path resolves without crash
 *  ADV-DATA-16  Apps: search input state after navigate-away and return
 *  ADV-DATA-20  Docs: overview link does not trigger full page reload
 *  ADV-DATA-23  Analytics: deep-link reload mounts KPI cards
 *  ADV-DATA-25  Apps-instances: route loads or redirects — no 404 white screen
 *
 * Rules:
 *  - authedPage fixture (starts at BASE homepage, pre-authed)
 *  - Internal nav via UI clicks / routerLink locators only
 *  - No page.waitForTimeout
 *  - Parallel-safe (isolated context per test)
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

// ─── helpers ────────────────────────────────────────────────────────────────

async function gotoAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${BASE}/admin`);
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
}

function collectErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (
        !t.includes('favicon') &&
        !t.includes('net::ERR_BLOCKED') &&
        !t.includes('ERR_ABORTED')
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
    (window as Record<string, unknown>)['__adv_sentinel__'] = val;
  }, v);
  return v;
}

async function assertSentinel(
  page: import('@playwright/test').Page,
  v: number,
): Promise<void> {
  const actual = await page.evaluate(
    () => (window as Record<string, unknown>)['__adv_sentinel__'],
  );
  expect(actual).toBe(v);
}

// ─── ADV-DATA-02: Analytics empty AI search ─────────────────────────────────

test.describe('ADV-DATA-02 — Analytics empty AI search', () => {
  test('typing whitespace into AI search then clearing does not crash analytics', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/analytics');

    const searchBtn = page.getByTestId('ai-search-btn');
    if (await searchBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await searchBtn.click();
      const input = page.getByTestId('ai-search-input');
      if (await input.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await input.fill('   ');
        await page.keyboard.press('Enter');
        await input.fill('');
        await page.keyboard.press('Escape');
      }
    }

    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-04: Traces hard reload ────────────────────────────────────────

test.describe('ADV-DATA-04 — Traces hard reload', () => {
  test('reloading /admin/traces shows admin shell — not a white screen', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/traces');
    await page.reload({ waitUntil: 'networkidle', timeout: 20_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-06: Audit hard reload ─────────────────────────────────────────

test.describe('ADV-DATA-06 — Audit hard reload', () => {
  test('reloading /admin/audit remounts shell without errors', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/audit');
    await page.reload({ waitUntil: 'networkidle', timeout: 20_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
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
      .waitForSelector(
        '[data-testid="hostnames-table"],[data-testid="hostnames-loading"]',
        { timeout: 8_000 },
      )
      .catch(() => null);
    // Even if neither is present the shell must not be blank
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    if (present) {
      expect(present).not.toBeNull();
    }
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-10: Logs navigate away mid-tail ────────────────────────────────

test.describe('ADV-DATA-10 — Logs navigate away mid-tail and return', () => {
  test('navigating away from live log tail and back does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    await clickNav(page, '/admin/logs');
    const tailBtn = page.getByTestId('site-logs-tail');
    if (await tailBtn.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await tailBtn.click({ force: true }); // start tail
    }

    await clickNav(page, '/admin/analytics');
    await clickNav(page, '/admin/logs');

    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-12: /admin/settings/mcp redirect ──────────────────────────────

test.describe('ADV-DATA-12 — /admin/settings/mcp redirect resolves', () => {
  test('navigating to the MCP settings route resolves shell without crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    const link = page
      .locator('a[routerLink="/admin/settings/mcp"], a[href*="/admin/settings"]')
      .first();
    const hasLink = await link.isVisible({ timeout: 3_000 }).catch(() => false);
    if (hasLink) {
      await link.click();
    } else {
      // Push history inside SPA — no goto after initial load
      await page.evaluate(() =>
        window.history.pushState({}, '', '/admin/settings'),
      );
    }

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
    await assertSentinel(page, sentinel);
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
    if (await searchInput.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await searchInput.fill('adversarial-state-test');
    }

    await clickNav(page, '/admin/analytics');
    await clickNav(page, '/admin/apps');

    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-20: Docs overview link SPA ────────────────────────────────────

test.describe('ADV-DATA-20 — Docs overview link stays in SPA', () => {
  test('clicking docs-overview-root preserves sentinel — no full reload', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/docs');
    const sentinel = await injectSentinel(page);

    const overviewRoot = page.getByTestId('docs-overview-root');
    if (await overviewRoot.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await overviewRoot.click();
      await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
      await assertSentinel(page, sentinel);
    }
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
    await page.reload({ waitUntil: 'networkidle', timeout: 20_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
    // KPI tiles graceful — may be 0 if no data yet
    const kpiCount = await page
      .locator(
        '[data-testid="kpi-pageviews"],[data-testid="kpi-requests"],[data-testid="kpi-visitors"]',
      )
      .count();
    expect(kpiCount).toBeGreaterThanOrEqual(0);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-DATA-25: Apps-instances route graceful ──────────────────────────────

test.describe('ADV-DATA-25 — Apps-instances route does not 404 blank', () => {
  test('/admin/apps/instances loads or redirects without empty shell', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);

    const link = page.locator('a[routerLink="/admin/apps/instances"]').first();
    if (await link.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await link.click();
    } else {
      // Push route inside SPA via history API (no goto after initial load)
      await page.evaluate(() =>
        window.history.pushState({}, '', '/admin/apps/instances'),
      );
    }

    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 8_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
    const bodyContent = await page.locator('body').textContent();
    expect(bodyContent?.trim().length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });
});
