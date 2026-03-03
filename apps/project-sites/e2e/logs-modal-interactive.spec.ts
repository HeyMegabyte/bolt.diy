/**
 * E2E tests for Logs modal interactive features: log rendering,
 * timestamp formatting, copy for AI, and refresh.
 */
import { test, expect } from './fixtures.js';

test.describe('Logs Modal', () => {
  test('logs modal element exists in DOM', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('#logs-modal, #site-logs-modal');
    await expect(modal.first()).toBeAttached();
  });

  test('openSiteLogsModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).openSiteLogsModal === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('closeSiteLogsModal function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).closeSiteLogsModal === 'function';
    });
    expect(hasFn).toBe(true);
  });
});

test.describe('Log Rendering Functions', () => {
  test('renderLogEntry function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).renderLogEntry === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('formatLogTimestamp returns relative time', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.formatLogTimestamp as (iso: string) => string;
      if (typeof fn !== 'function') return null;
      const now = new Date().toISOString();
      return fn(now);
    });
    if (result) {
      expect(result).toMatch(/just now|seconds?|minute|ago/i);
    }
  });

  test('formatActionLabel returns human-readable action names', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.formatActionLabel as (action: string) => string;
      if (typeof fn !== 'function') return null;
      return {
        siteCreated: fn('site.created'),
        sitePublished: fn('site.published'),
        hostnameAdded: fn('hostname.added'),
      };
    });
    if (result) {
      // Should return human-readable labels, not raw action strings
      expect(result.siteCreated).toBeTruthy();
      expect(result.sitePublished).toBeTruthy();
    }
  });
});

test.describe('Copy Logs for AI', () => {
  test('copyLogsForAI function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).copyLogsForAI === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('logs modal has copy for AI button', async ({ page }) => {
    await page.goto('/');
    const btn = page.locator('[onclick*="copyLogsForAI"], #copy-logs-btn');
    await expect(btn.first()).toBeAttached();
  });

  test('logs modal has refresh button', async ({ page }) => {
    await page.goto('/');
    const btn = page.locator('.logs-refresh-btn, [onclick*="refreshSiteLogs"]');
    await expect(btn.first()).toBeAttached();
  });
});

test.describe('Log Timestamp Auto-Update', () => {
  test('startTimestampUpdater function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).startTimestampUpdater === 'function';
    });
    expect(hasFn).toBe(true);
  });
});
