import { test, expect } from '@playwright/test';

const CHECKMATE_URL = process.env.CHECKMATE_URL || 'https://monitor.projectsites.dev';

test.describe('Checkmate — login page smoke test', () => {
  test('homepage loads and shows login/setup UI', async ({ page }) => {
    // Navigate to Checkmate
    const response = await page.goto(CHECKMATE_URL, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // 1. HTTP status is 200
    expect(response?.status()).toBe(200);

    // 2. Page has a title
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // 3. The page renders the React root
    const root = page.locator('#root');
    await expect(root).toBeAttached({ timeout: 10000 });

    // 4. Check for Checkmate login/setup indicators
    //    The login page typically has a form with email/password fields
    //    or a "Create Account" / "Sign In" prompt
    const bodyText = await page.textContent('body');

    // Accept any of: login form, setup wizard, or React app shell with content
    const hasLoginForm = await page.locator('input[type="email"], input[name="email"]').count();
    const hasPasswordField = await page.locator('input[type="password"]').count();
    const hasSubmitButton = await page.locator('button[type="submit"]').count();
    const hasAuthText =
      /sign in|log in|login|sign up|create account|setup|welcome|get started/i.test(
        bodyText || ''
      );

    // At least one indicator of an auth/setup page must be present
    const hasAuthUI = hasLoginForm > 0 || hasPasswordField > 0 || hasSubmitButton > 0 || hasAuthText;

    expect(hasAuthUI).toBeTruthy();

    // 5. No Cloudflare Access interstitial (page should be Checkmate, not a CF challenge)
    const cfAccessText = /cloudflare access|cf-turnstile|cf-challenge|Just a moment/i;
    expect(bodyText || '').not.toMatch(cfAccessText);

    // 6. Take screenshot on failure
    if (!hasAuthUI) {
      await page.screenshot({
        path: `e2e/screenshots/checkmate-login-fail-${Date.now()}.png`,
        fullPage: true,
      });
      console.log(`Page title: "${title}"`);
      console.log(`Body preview: ${(bodyText || '').substring(0, 500)}`);
    }
  });

  test('API health is reachable behind nginx proxy', async ({ page }) => {
    const apiResponse = await page.request.get(`${CHECKMATE_URL}/api/v1/health`, {
      timeout: 10000,
    });
    // Health endpoint must return 200
    expect(apiResponse.status()).toBe(200);
  });

  test('page does not contain CF Access challenge', async ({ page }) => {
    await page.goto(CHECKMATE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const html = await page.content();

    // These strings indicate a CF challenge page, not the app
    expect(html).not.toContain('cf-turnstile');
    expect(html).not.toContain('cf-challenge-running');
    expect(html).not.toContain('Just a moment');
    expect(html).not.toContain('Checking your browser');
  });
});
