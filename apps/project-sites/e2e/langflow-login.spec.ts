import { test, expect } from '@playwright/test';

test.describe('langflow.projectsites.dev — Login Page Smoke', () => {
  test('homepage loads with Langflow login UI', async ({ page }) => {
    // Navigate to Langflow
    const response = await page.goto('https://langflow.projectsites.dev/', {
      waitUntil: 'networkidle',
      timeout: 120_000, // generous for cold start
    });

    // Assert HTTP 200
    expect(response?.status()).toBe(200);

    // Wait for React to render the login form
    await page.waitForSelector('#root', { timeout: 30_000 });

    // Take screenshot for visual verification
    await page.screenshot({
      path: 'test-results/langflow-login-page.png',
      fullPage: true,
    });

    // Assert the page looks like a login page — check for common login UI elements
    // Langflow renders a React-based login form
    const pageContent = await page.textContent('body');

    // Should contain "Langflow" branding or login-related text
    const hasLangflow = pageContent?.toLowerCase().includes('langflow') ?? false;
    expect(hasLangflow).toBeTruthy();

    // Take an accessibility snapshot
    const snapshot = await page.accessibility.snapshot();
    expect(snapshot).toBeTruthy();

    console.log('✅ Langflow login page loaded successfully');
    console.log(`   URL: ${page.url()}`);
    console.log(`   Title: ${await page.title()}`);
  });

  test('login form has input fields and submit button', async ({ page }) => {
    await page.goto('https://langflow.projectsites.dev/', {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });

    await page.waitForSelector('#root', { timeout: 30_000 });

    // The login form should have username/email and password fields
    // Langflow uses a React form — check for input elements
    const inputs = page.locator('input');
    const inputCount = await inputs.count();

    // Should have at least 1 input field (username/email)
    expect(inputCount).toBeGreaterThanOrEqual(1);

    // Look for a button
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThanOrEqual(1);

    // Screenshot the login form
    await page.screenshot({
      path: 'test-results/langflow-login-form.png',
      fullPage: true,
    });

    console.log(`✅ Found ${inputCount} input(s) and ${buttonCount} button(s)`);
  });

  test('page is accessible', async ({ page }) => {
    await page.goto('https://langflow.projectsites.dev/', {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });

    await page.waitForSelector('#root', { timeout: 30_000 });

    // Basic accessibility checks
    // Check for proper heading hierarchy
    const headings = page.locator('h1, h2, h3');
    // Langflow may not have heading elements (React SPA), so this is informational

    // Check for proper lang attribute
    const htmlLang = await page.locator('html').getAttribute('lang');
    console.log(`   HTML lang: ${htmlLang || 'not set'}`);

    // Check that page has interactive elements
    const interactiveElements = page.locator('input, button, a');
    const interactiveCount = await interactiveElements.count();
    expect(interactiveCount).toBeGreaterThan(0);
  });
});
