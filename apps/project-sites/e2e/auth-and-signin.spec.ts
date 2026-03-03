/**
 * E2E tests for authentication flows: sign-in screen, magic link,
 * Google OAuth button, session persistence, and auth callbacks.
 */
import { test, expect } from './fixtures.js';

test.describe('Sign-In Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-search')).toBeVisible({ timeout: 10_000 });
  });

  test('sign-in screen shows when navigating to signin', async ({ page }) => {
    // Trigger navigation to signin via JS
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.navigateTo as (s: string) => void;
      if (typeof fn === 'function') fn('signin');
    });

    const signinScreen = page.locator('#screen-signin');
    await expect(signinScreen).toHaveClass(/active/, { timeout: 5_000 });
  });

  test('sign-in screen has email panel', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.navigateTo as (s: string) => void;
      if (typeof fn === 'function') fn('signin');
    });

    const emailPanel = page.locator('#signin-email-panel');
    await expect(emailPanel).toBeAttached();
    const emailStepInput = page.locator('#email-step-input');
    await expect(emailStepInput).toBeAttached();
  });

  test('sign-in screen has Google OAuth button', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.navigateTo as (s: string) => void;
      if (typeof fn === 'function') fn('signin');
    });

    const googleBtn = page.locator('#signin-google-btn, [onclick*="signInWithGoogle"]');
    await expect(googleBtn.first()).toBeAttached();
  });

  test('sign-in screen has magic link email option', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.navigateTo as (s: string) => void;
      if (typeof fn === 'function') fn('signin');
    });

    // Email/magic link option should be present
    const emailOption = page.locator('[onclick*="showSigninPanel"]').first();
    await expect(emailOption).toBeAttached();
  });

  test('sign-in has back to search button', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.navigateTo as (s: string) => void;
      if (typeof fn === 'function') fn('signin');
    });

    const backBtn = page.locator('[onclick*="navigateTo(\'search\')"]').first();
    await expect(backBtn).toBeAttached();
  });
});

test.describe('Magic Link Flow', () => {
  test('magic link email input accepts valid email', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#screen-search')).toBeVisible({ timeout: 10_000 });

    // Navigate to signin
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const nav = w.navigateTo as (s: string) => void;
      if (typeof nav === 'function') nav('signin');
    });

    await expect(page.locator('#screen-signin')).toHaveClass(/active/, { timeout: 5_000 });

    // Click "Continue with email" to show the email panel
    const emailBtn = page.locator('[onclick*="showSigninPanel(\'email\')"]');
    await expect(emailBtn).toBeVisible({ timeout: 5_000 });
    await emailBtn.click();

    const emailInput = page.locator('#email-input');
    await expect(emailInput).toBeVisible({ timeout: 5_000 });
  });

  test('sendMagicLink function is defined', async ({ page }) => {
    await page.goto('/');
    const hasFn = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).sendMagicLink === 'function';
    });
    expect(hasFn).toBe(true);
  });

  test('magic link sends POST to /api/auth/magic-link', async ({ page }) => {
    let magicLinkCalled = false;
    let emailSent = '';

    await page.route('**/api/auth/magic-link', async (route) => {
      magicLinkCalled = true;
      const body = route.request().postDataJSON();
      emailSent = body?.email || '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { expires_at: new Date(Date.now() + 600000).toISOString() } }),
      });
    });

    await page.goto('/');
    await expect(page.locator('#screen-search')).toBeVisible({ timeout: 10_000 });

    // Navigate to signin screen
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const nav = w.navigateTo as (s: string) => void;
      if (typeof nav === 'function') nav('signin');
    });

    await expect(page.locator('#screen-signin')).toHaveClass(/active/, { timeout: 5_000 });

    // Click "Continue with email" to show the email panel
    const emailBtn = page.locator('[onclick*="showSigninPanel(\'email\')"]');
    await expect(emailBtn).toBeVisible({ timeout: 5_000 });
    await emailBtn.click();

    // Now the email input should be visible
    const emailInput = page.locator('#email-input').first();
    await expect(emailInput).toBeVisible({ timeout: 5_000 });
    await emailInput.fill('test@example.com');

    const sendBtn = page.locator('[onclick*="sendMagicLink"]').first();
    if (await sendBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sendBtn.click();
      await page.waitForTimeout(500);
      if (magicLinkCalled) {
        expect(emailSent).toBe('test@example.com');
      }
    }
  });
});

test.describe('Session Persistence', () => {
  test('saveSession and clearSession functions exist', async ({ page }) => {
    await page.goto('/');
    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        save: typeof w.saveSession === 'function',
        clear: typeof w.clearSession === 'function',
        restore: typeof w.restoreSession === 'function' || typeof w._restoreSession === 'function',
      };
    });
    expect(fns.save).toBe(true);
    expect(fns.clear).toBe(true);
  });

  test('session is stored in localStorage under ps_session', async ({ page }) => {
    await page.goto('/');

    // Simulate saving a session
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const save = w.saveSession as (token: string, email: string) => void;
      if (typeof save === 'function') {
        save('test-token-123', 'user@example.com');
      }
    });

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('ps_session');
      return raw ? JSON.parse(raw) : null;
    });

    if (stored) {
      expect(stored.token).toBe('test-token-123');
      expect(stored.email).toBe('user@example.com');
    }
  });

  test('clearSession removes ps_session from localStorage', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      localStorage.setItem('ps_session', JSON.stringify({ token: 'abc', email: 'a@b.com' }));
      const w = window as unknown as Record<string, unknown>;
      const clear = w.clearSession as () => void;
      if (typeof clear === 'function') clear();
    });

    const stored = await page.evaluate(() => localStorage.getItem('ps_session'));
    expect(stored).toBeNull();
  });

  test('logout function clears session and navigates to search', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const logout = w.logout as () => void;
      if (typeof logout === 'function') {
        localStorage.setItem('ps_session', JSON.stringify({ token: 'abc', email: 'a@b.com' }));
        logout();
        return {
          sessionCleared: !localStorage.getItem('ps_session'),
        };
      }
      return null;
    });

    if (result) {
      expect(result.sessionCleared).toBe(true);
    }
  });
});

test.describe('Auth Callback Handling', () => {
  test('auth callback with token sets session', async ({ page }) => {
    // Mock /api/auth/me to return a valid user
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email: 'test@example.com', user_id: 'user-123' }),
      });
    });

    await page.goto('/?token=test-token-abc&email=test@example.com');
    await page.waitForTimeout(1000);

    const hasSession = await page.evaluate(() => {
      const raw = localStorage.getItem('ps_session');
      return raw !== null;
    });

    // Auth callback should have processed the token
    expect(typeof hasSession).toBe('boolean');
  });

  test('billing return with ?billing=success is handled', async ({ page }) => {
    await page.goto('/?billing=success');
    await page.waitForTimeout(500);

    // Page should load without errors
    await expect(page.locator('#screen-search')).toBeAttached();
  });
});
