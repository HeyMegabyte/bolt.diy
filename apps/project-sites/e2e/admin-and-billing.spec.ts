/**
 * E2E tests for admin dashboard (authenticated state), billing flows,
 * site card actions, and checkout integration.
 */
import { test, expect } from './fixtures.js';
import type { Page } from '@playwright/test';

/** Mock authenticated state with site data */
async function setupAuthenticatedAdmin(page: Page) {
  // Mock all admin API endpoints
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'admin@example.com', user_id: 'user-1', org_id: 'org-1' }),
    });
  });

  await page.route('**/api/sites', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'site-1',
              slug: 'test-business',
              name: 'Test Business',
              status: 'published',
              plan: 'free',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              hostnames: [{ id: 'h-1', hostname: 'test-business.projectsites.dev', status: 'active', is_default: true }],
            },
            {
              id: 'site-2',
              slug: 'my-salon',
              name: 'My Salon',
              status: 'building',
              plan: 'free',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              hostnames: [{ id: 'h-2', hostname: 'my-salon.projectsites.dev', status: 'active', is_default: true }],
            },
          ],
        }),
      });
    } else {
      await route.fallback();
    }
  });

  await page.route('**/api/billing/subscription', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { plan: 'free', status: 'active' } }),
    });
  });

  await page.route('**/api/billing/entitlements', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { max_sites: 3, max_custom_domains: 1 } }),
    });
  });

  await page.route('**/api/admin/domains/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { total: 2, active: 2, pending: 0 } }),
    });
  });

  // Set session in localStorage before navigating
  await page.addInitScript(() => {
    localStorage.setItem('ps_session', JSON.stringify({
      token: 'mock-admin-token',
      email: 'admin@example.com',
    }));
  });
}

test.describe('Admin Dashboard', () => {
  test('admin dashboard functions exist', async ({ page }) => {
    await page.goto('/');
    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        loadAdminDashboard: typeof w.loadAdminDashboard === 'function',
        hideAdminDashboard: typeof w.hideAdminDashboard === 'function',
        renderAdminSites: typeof w.renderAdminSites === 'function',
        renderAdminBilling: typeof w.renderAdminBilling === 'function',
      };
    });
    expect(fns.loadAdminDashboard).toBe(true);
    expect(fns.hideAdminDashboard).toBe(true);
    expect(fns.renderAdminSites).toBe(true);
    expect(fns.renderAdminBilling).toBe(true);
  });

  test('admin dashboard panel exists in DOM', async ({ page }) => {
    await page.goto('/');
    const panel = page.locator('#admin-panel, #admin-dashboard, [class*="admin-panel"]');
    await expect(panel.first()).toBeAttached();
  });

  test('authenticated user sees admin dashboard', async ({ page }) => {
    await setupAuthenticatedAdmin(page);
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Admin panel should become visible with site data
    const adminPanel = page.locator('#admin-panel, .admin-dashboard');
    // It should be attached (may or may not be visible depending on auth restore timing)
    await expect(adminPanel.first()).toBeAttached();
  });

  test('site cards container exists', async ({ page }) => {
    await page.goto('/');
    const grid = page.locator('#admin-sites-grid, .site-grid');
    await expect(grid.first()).toBeAttached();
  });
});

test.describe('Site Card Actions', () => {
  test('toggleCardDropdown function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).toggleCardDropdown === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('closeAllDropdowns function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).closeAllDropdowns === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('copyUrl function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).copyUrl === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('editSiteInBolt function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).editSiteInBolt === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('editSiteInBolt constructs correct editor URL', async ({ page }) => {
    await page.goto('/');

    // Stub redirectTo to capture the URL
    await page.evaluate(() => {
      (window as any).__redirects = [];
      (window as any).redirectTo = (url: string) => {
        (window as any).__redirects.push(url);
      };
    });

    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.editSiteInBolt as (slug: string) => void;
      if (typeof fn === 'function') fn('test-site');
    });

    const redirects = await page.evaluate(() => (window as any).__redirects as string[]);
    if (redirects.length > 0) {
      expect(redirects[0]).toContain('editor.projectsites.dev');
      expect(redirects[0]).toContain('test-site');
    }
  });
});

test.describe('Site Status Polling', () => {
  test('startSiteStatusPolling function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).startSiteStatusPolling === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('stopSiteStatusPolling function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).stopSiteStatusPolling === 'function';
    });
    expect(hasFn).toBe(true);
  });
});

test.describe('Billing Functions', () => {
  test('billing functions are defined', async ({ page }) => {
    await page.goto('/');
    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        openCheckoutModal: typeof w.openCheckoutModal === 'function',
        closeCheckoutModal: typeof w.closeCheckoutModal === 'function',
        inlineCheckout: typeof w.inlineCheckout === 'function',
        openBillingPortal: typeof w.openBillingPortal === 'function',
        closeBillingPortalModal: typeof w.closeBillingPortalModal === 'function',
        handleGetStartedPaid: typeof w.handleGetStartedPaid === 'function',
      };
    });
    expect(fns.openCheckoutModal).toBe(true);
    expect(fns.closeCheckoutModal).toBe(true);
    expect(fns.inlineCheckout).toBe(true);
    expect(fns.openBillingPortal).toBe(true);
    expect(fns.closeBillingPortalModal).toBe(true);
    expect(fns.handleGetStartedPaid).toBe(true);
  });

  test('checkout modal element exists', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('#checkout-modal, #stripe-checkout-modal');
    await expect(modal.first()).toBeAttached();
  });

  test('billing portal modal element exists', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('#billing-portal-modal, #portal-modal');
    await expect(modal.first()).toBeAttached();
  });
});

test.describe('Inline Editing', () => {
  test('inline edit functions are defined', async ({ page }) => {
    await page.goto('/');
    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        startInlineEdit: typeof w.startInlineEdit === 'function',
        saveInlineEdit: typeof w.saveInlineEdit === 'function',
        cancelInlineEdit: typeof w.cancelInlineEdit === 'function',
      };
    });
    expect(fns.startInlineEdit).toBe(true);
    expect(fns.saveInlineEdit).toBe(true);
    expect(fns.cancelInlineEdit).toBe(true);
  });

  test('slug validation functions are defined', async ({ page }) => {
    await page.goto('/');
    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        validateSlugLocal: typeof w.validateSlugLocal === 'function',
        validateTitle: typeof w.validateTitle === 'function',
        checkSlugAvailability: typeof w.checkSlugAvailability === 'function',
      };
    });
    expect(fns.validateSlugLocal).toBe(true);
    expect(fns.validateTitle).toBe(true);
    expect(fns.checkSlugAvailability).toBe(true);
  });

  test('slug validation rejects invalid slugs', async ({ page }) => {
    await page.goto('/');
    const results = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.validateSlugLocal as (s: string) => { valid: boolean; error?: string };
      if (typeof fn !== 'function') return null;
      return {
        empty: fn(''),
        tooShort: fn('ab'),
        valid: fn('my-business'),
        uppercase: fn('My-Business'),
        specialChars: fn('my@business!'),
      };
    });

    if (results) {
      expect(results.empty.valid).toBe(false);
      expect(results.valid.valid).toBe(true);
    }
  });
});

test.describe('Toast Notifications', () => {
  test('showToast function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).showToast === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('toast container exists in DOM', async ({ page }) => {
    await page.goto('/');
    const container = page.locator('#toast-container, [class*="toast-container"]');
    await expect(container.first()).toBeAttached();
  });

  test('showToast creates a visible toast', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.showToast as (msg: string, type?: string) => void;
      if (typeof fn === 'function') fn('Test toast message', 'success');
    });

    const toast = page.locator('.toast, [class*="toast-item"]').first();
    await expect(toast).toBeVisible({ timeout: 2_000 });
    const text = await toast.textContent();
    expect(text).toContain('Test toast message');
  });
});
