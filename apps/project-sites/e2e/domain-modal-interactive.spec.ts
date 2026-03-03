/**
 * E2E tests for Domain Modal interactive flows: tab switching,
 * hostname management, CNAME monitoring, and domain search.
 */
import { test, expect } from './fixtures.js';

test.describe('Domain Modal', () => {
  test('domain modal element exists in DOM', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('#domain-modal');
    await expect(modal).toBeAttached();
  });

  test('openDomainModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).openDomainModal === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('closeDomainModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).closeDomainModal === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('domain modal has tab navigation', async ({ page }) => {
    await page.goto('/');
    const tabs = page.locator('#domain-modal .domain-tab, [onclick*="switchDomainTab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('switchDomainTab function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).switchDomainTab === 'function';
    });
    expect(hasFn).toBe(true);
  });
});

test.describe('Domain Modal - Hostname Management', () => {
  test('loadHostnames function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).loadHostnames === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('addHostname function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).addHostname === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('deleteHostname function is defined', async ({ page }) => {
    await page.goto('/');
    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        deleteHostname: typeof w.deleteHostname === 'function' || typeof w.deleteHostnameWithWarning === 'function',
        verifyHostname: typeof w.verifyHostname === 'function',
      };
    });
    expect(fns.deleteHostname).toBe(true);
  });

  test('setPrimaryHostname function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).setPrimaryHostname === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('resetPrimaryToDefault function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).resetPrimaryToDefault === 'function';
    });
    expect(hasFn).toBe(true);
  });
});

test.describe('Domain Modal - CNAME Monitor', () => {
  test('CNAME monitoring functions are defined', async ({ page }) => {
    await page.goto('/');
    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        showCnameMonitor: typeof w.showCnameMonitor === 'function',
        showCnameDiagnostics: typeof w.showCnameDiagnostics === 'function',
        startCnamePolling: typeof w.startCnamePolling === 'function',
      };
    });
    expect(fns.showCnameMonitor).toBe(true);
    expect(fns.startCnamePolling).toBe(true);
  });

  test('CNAME instructions reference projectsites.dev', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // CNAME instructions should point to the new domain
    expect(html).toContain('projectsites.dev');
  });
});

test.describe('Domain Modal - Domain Search (Register Tab)', () => {
  test('domain search functions are defined', async ({ page }) => {
    await page.goto('/');
    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        searchDomains: typeof w.searchDomains === 'function',
        renderDomainSearchResults: typeof w.renderDomainSearchResults === 'function',
        selectDomainForPurchase: typeof w.selectDomainForPurchase === 'function',
      };
    });
    expect(fns.searchDomains).toBe(true);
    expect(fns.selectDomainForPurchase).toBe(true);
  });

  test('domain search input exists in register tab', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#domain-search-input, [placeholder*="domain" i]');
    await expect(input.first()).toBeAttached();
  });
});

test.describe('Domain Modal - Hostname URL Toggle', () => {
  test('toggleHostnameUrl function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).toggleHostnameUrl === 'function';
    });
    expect(hasFn).toBe(true);
  });
});
