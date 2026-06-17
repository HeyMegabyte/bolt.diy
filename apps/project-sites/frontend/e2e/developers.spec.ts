import { test, expect } from '@playwright/test';

/**
 * E2E tests for the /developers MCP acquisition page.
 *
 * Every test starts at the homepage per the homepage-first E2E rule and
 * navigates to /developers via the "Developers" nav link, exactly as a real
 * developer visitor would.
 *
 * Selectors use role + visible text or stable CSS class names from
 * developers.component.html — never brittle nth-child paths.
 */

test.describe('Developers page — MCP acquisition', () => {

  test('desktop: nav "Developers" link routes to /developers with visible H1', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');

    // Navigate via the marketing header's "Developers" link — real user action.
    const devLink = page.getByRole('link', { name: 'Developers' }).first();
    await expect(devLink).toBeVisible();
    await devLink.click();

    await expect(page).toHaveURL(/\/developers/);

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('Deploy from your editor');

    expect(consoleErrors).toHaveLength(0);
  });

  test('MCP snippet is visible and contains psk_ token placeholder and api/mcp endpoint', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Developers' }).first().click();
    await expect(page).toHaveURL(/\/developers/);

    // Hero snippet — rendered from mcpSnippet property in DevelopersComponent.
    // The template outputs {{ mcpSnippet }} inside <code> inside .dev-hero .dev-snippet__code.
    const heroSnippet = page.locator('.dev-hero .dev-snippet__code code');
    await expect(heroSnippet).toBeVisible();
    await expect(heroSnippet).toContainText('psk_YOUR_TOKEN');
    await expect(heroSnippet).toContainText('projectsites.dev/api/mcp');

    // Verify section shows the bare curl command so developers can manually check.
    const verifySnippet = page.locator('.dev-verify .dev-snippet__code code');
    await expect(verifySnippet).toBeVisible();
    await expect(verifySnippet).toContainText('projectsites.dev/api/mcp');
  });

  test('tool table lists deploy_site and create_site rows', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Developers' }).first().click();
    await expect(page).toHaveURL(/\/developers/);

    // Tool names from DevelopersComponent.tools — rendered via @for in the template.
    await expect(page.locator('.dev-tool-name', { hasText: 'deploy_site' })).toBeVisible();
    await expect(page.locator('.dev-tool-name', { hasText: 'create_site' })).toBeVisible();

    // Verify the full set of 6 tools is rendered (whoami, list_sites, get_site,
    // get_build_status, deploy_site, create_site).
    await expect(page.locator('.dev-tool-name')).toHaveCount(6);
  });

  test('copy button is visible, enabled, and clickable without non-clipboard console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await page.getByRole('link', { name: 'Developers' }).first().click();
    await expect(page).toHaveURL(/\/developers/);

    // Copy button — aria-label cycles between two values (idle vs copied state).
    const copyBtn = page.locator('button.dev-snippet__copy').first();
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toBeEnabled();

    // Click — clipboard permission not available in headless; only assert no errors
    // unrelated to clipboard (clipboard 403s are expected in headless environments).
    await copyBtn.click();

    const nonClipboardErrors = consoleErrors.filter(
      e => !e.toLowerCase().includes('clipboard')
    );
    expect(nonClipboardErrors).toHaveLength(0);
  });

  test('page has exactly one H1 and zero console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await page.getByRole('link', { name: 'Developers' }).first().click();
    await expect(page).toHaveURL(/\/developers/);

    // WCAG 2.2 — one H1 per page.
    const h1s = page.locator('h1');
    expect(await h1s.count()).toBe(1);

    expect(consoleErrors).toHaveLength(0);
  });

  test('mobile 375px: nav link (with optional hamburger) → /developers → H1 visible', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    // Attempt to open a mobile hamburger/nav-toggle if the nav links are collapsed.
    // Gracefully no-ops if the link is already in the DOM and visible (some SPAs keep
    // links in the DOM but hidden behind a hamburger, others render them conditionally).
    const hamburger = page.locator([
      '[data-testid="mobile-menu-toggle"]',
      'button[aria-label*="menu" i]',
      'button[aria-label*="navigation" i]',
      '.hamburger',
      '.nav-toggle',
      '[class*="hamburger"]',
      '[class*="mobile-nav"]',
    ].join(', ')).first();

    const hamburgerVisible = await hamburger.isVisible().catch(() => false);
    if (hamburgerVisible) {
      await hamburger.click();
    }

    const devLink = page.getByRole('link', { name: 'Developers' }).first();
    await expect(devLink).toBeVisible({ timeout: 5000 });
    await devLink.click();

    await expect(page).toHaveURL(/\/developers/);

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('Deploy from your editor');

    const nonClipboardErrors = consoleErrors.filter(
      e => !e.toLowerCase().includes('clipboard')
    );
    expect(nonClipboardErrors).toHaveLength(0);
  });

});
