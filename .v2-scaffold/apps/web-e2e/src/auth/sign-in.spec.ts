/**
 * sign-in.spec.ts — TDD RED phase
 *
 * Covers every authentication method available in the web app:
 *   OAuth (Google / GitHub / Apple / Microsoft / Facebook)
 *   Email magic-link
 *   SMS magic-link
 *   Voice OTP
 *   Passkey (virtual WebAuthn authenticator)
 *   TOTP enroll + verify
 *
 * Regression: "Sign in" button click must actually navigate away from /login.
 *
 * @remarks
 * All specs are hermetic — each starts at "/" and navigates via clicks.
 * OAuth provider redirects are intercepted with route.fulfill() so no
 * real OAuth round-trip occurs.
 */

import { test, expect } from '@playwright/test';
import { registerVirtualPasskey } from '../_fixtures/stripe.js';
import { watchConsoleErrors } from '../_helpers/console-errors.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

async function navigateToLogin(page: Parameters<typeof test>[1]['page']): Promise<void> {
  await page.goto('/');
  // Navigate to login via the UI, not bare page.goto('/login')
  const loginLink = page.getByRole('link', { name: /sign in/i }).or(
    page.getByTestId('nav-signin'),
  );
  if (await loginLink.isVisible()) {
    await loginLink.click();
  } else {
    // App may redirect unauthenticated users automatically
    await page.waitForURL('**/login**');
  }
  await expect(page).toHaveURL(/\/login/);
}

/* ------------------------------------------------------------------ */
/* OAuth providers                                                      */
/* ------------------------------------------------------------------ */

for (const provider of ['Google', 'GitHub', 'Apple', 'Microsoft', 'Facebook'] as const) {
  test(`OAuth ${provider} button click navigates to provider`, async ({ page }) => {
    const consoleErrors = watchConsoleErrors(page);
    await navigateToLogin(page);

    // Intercept OAuth redirect so we don't leave the domain
    await page.route(`**/${provider.toLowerCase()}**`, async (route) => {
      await route.fulfill({
        status: 302,
        headers: { Location: `http://localhost:4200/auth/callback?provider=${provider.toLowerCase()}&code=test` },
      });
    });

    const oauthBtn = page
      .getByRole('button', { name: new RegExp(provider, 'i') })
      .or(page.getByTestId(`auth-oauth-${provider.toLowerCase()}`));

    await expect(oauthBtn).toBeVisible();
    await oauthBtn.click();

    // After click, the page should no longer sit on /login (navigation fired)
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 5_000 });
    consoleErrors.assertNone();
  });
}

/* ------------------------------------------------------------------ */
/* Email magic-link                                                     */
/* ------------------------------------------------------------------ */

test('email magic-link — form submits and shows success toast', async ({ page }) => {
  const consoleErrors = watchConsoleErrors(page);
  await navigateToLogin(page);

  // Intercept the magic-link API call
  await page.route('**/api/auth/magic-link**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sent: true }),
    });
  });

  const emailInput = page
    .getByRole('textbox', { name: /email/i })
    .or(page.getByTestId('auth-email-input'));

  await expect(emailInput).toBeVisible();
  await emailInput.fill('user@example.com');
  await page.keyboard.press('Tab');

  const magicLinkBtn = page
    .getByRole('button', { name: /magic link|send link|email me/i })
    .or(page.getByTestId('auth-magic-link-btn'));

  await magicLinkBtn.click();

  // Success toast must appear
  await expect(
    page.getByRole('status').or(page.getByTestId('toast-success')),
  ).toBeVisible({ timeout: 5_000 });

  consoleErrors.assertNone();
});

/* ------------------------------------------------------------------ */
/* SMS magic-link                                                       */
/* ------------------------------------------------------------------ */

test('SMS magic-link — phone input detected, POST to Twilio Verify', async ({ page }) => {
  await navigateToLogin(page);

  let twilioCallMade = false;
  await page.route('**/api/auth/sms**', async (route) => {
    twilioCallMade = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sent: true }),
    });
  });

  const phoneTab = page
    .getByRole('tab', { name: /phone|sms/i })
    .or(page.getByTestId('auth-tab-sms'));
  if (await phoneTab.isVisible()) {
    await phoneTab.click();
  }

  const phoneInput = page
    .getByRole('textbox', { name: /phone/i })
    .or(page.getByTestId('auth-phone-input'));

  await expect(phoneInput).toBeVisible();
  await phoneInput.fill('+12125550100');

  const sendSmsBtn = page
    .getByRole('button', { name: /send code|text me|sms/i })
    .or(page.getByTestId('auth-sms-btn'));
  await sendSmsBtn.click();

  await expect(page.getByTestId('auth-otp-input').or(page.getByRole('textbox', { name: /code/i }))).toBeVisible({
    timeout: 5_000,
  });

  expect(twilioCallMade).toBe(true);
});

/* ------------------------------------------------------------------ */
/* Voice OTP                                                            */
/* ------------------------------------------------------------------ */

test('voice OTP — call me, enter 6-digit code, success', async ({ page }) => {
  await navigateToLogin(page);

  await page.route('**/api/auth/voice-otp**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ called: true }),
    });
  });

  await page.route('**/api/auth/verify-otp**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ verified: true, sessionToken: 'test-token' }),
    });
  });

  const phoneTab = page
    .getByRole('tab', { name: /phone|voice/i })
    .or(page.getByTestId('auth-tab-voice'));
  if (await phoneTab.isVisible()) await phoneTab.click();

  const phoneInput = page
    .getByRole('textbox', { name: /phone/i })
    .or(page.getByTestId('auth-phone-input'));
  await expect(phoneInput).toBeVisible();
  await phoneInput.fill('+12125550100');

  const callBtn = page
    .getByRole('button', { name: /call me/i })
    .or(page.getByTestId('auth-voice-btn'));
  await callBtn.click();

  const codeInput = page
    .getByRole('textbox', { name: /code/i })
    .or(page.getByTestId('auth-otp-input'));
  await expect(codeInput).toBeVisible({ timeout: 5_000 });

  await codeInput.fill('123456');
  await page.keyboard.press('Enter');

  await expect(
    page.getByRole('status').or(page.getByTestId('toast-success')),
  ).toBeVisible({ timeout: 5_000 });
});

/* ------------------------------------------------------------------ */
/* Passkey                                                              */
/* ------------------------------------------------------------------ */

test('passkey — virtual authenticator auto-approves assertion', async ({ page, context }) => {
  await registerVirtualPasskey(context);
  await navigateToLogin(page);

  await page.route('**/api/auth/passkey/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ verified: true, sessionToken: 'test-token-passkey' }),
    });
  });

  const passkeyBtn = page
    .getByRole('button', { name: /passkey|biometric|use face|fingerprint/i })
    .or(page.getByTestId('auth-passkey-btn'));

  await expect(passkeyBtn).toBeVisible();
  await passkeyBtn.click();

  // Virtual authenticator resolves silently — success indicator should appear
  await expect(
    page.getByRole('status').or(page.getByTestId('toast-success')).or(page.getByTestId('auth-success')),
  ).toBeVisible({ timeout: 8_000 });
});

/* ------------------------------------------------------------------ */
/* TOTP enroll                                                          */
/* ------------------------------------------------------------------ */

test('TOTP enroll — QR renders, enter code, success', async ({ page }) => {
  await navigateToLogin(page);

  await page.route('**/api/auth/totp/enroll**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        qrCodeDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        secret: 'JBSWY3DPEHPK3PXP',
      }),
    });
  });

  await page.route('**/api/auth/totp/verify**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ verified: true }),
    });
  });

  const totpTab = page
    .getByRole('tab', { name: /authenticator|totp/i })
    .or(page.getByTestId('auth-tab-totp'));
  if (await totpTab.isVisible()) await totpTab.click();

  const enrollBtn = page
    .getByRole('button', { name: /set up authenticator|enroll/i })
    .or(page.getByTestId('auth-totp-enroll-btn'));
  if (await enrollBtn.isVisible()) await enrollBtn.click();

  // QR code image must be rendered
  const qrImage = page.getByRole('img', { name: /qr/i }).or(page.getByTestId('auth-totp-qr'));
  await expect(qrImage).toBeVisible({ timeout: 5_000 });

  const codeInput = page
    .getByRole('textbox', { name: /code/i })
    .or(page.getByTestId('auth-totp-code'));
  await codeInput.fill('123456');
  await page.keyboard.press('Enter');

  await expect(
    page.getByRole('status').or(page.getByTestId('toast-success')),
  ).toBeVisible({ timeout: 5_000 });
});

/* ------------------------------------------------------------------ */
/* Regression: sign-in button actually navigates                       */
/* ------------------------------------------------------------------ */

test('regression: clicking Sign In navigates away from /login', async ({ page }) => {
  await navigateToLogin(page);

  await page.route('**/api/auth/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessionToken: 'mock', csrfToken: 'mock-csrf' }),
    });
  });

  const emailInput = page
    .getByRole('textbox', { name: /email/i })
    .or(page.getByTestId('auth-email-input'));
  await emailInput.fill('brian@megabyte.space');

  const passwordInput = page
    .getByLabel(/password/i)
    .or(page.getByTestId('auth-password-input'));
  if (await passwordInput.isVisible()) {
    await passwordInput.fill('test-password');
  }

  const signInBtn = page
    .getByRole('button', { name: /^sign in$/i })
    .or(page.getByTestId('auth-signin-btn'));

  await signInBtn.click();

  // The page must navigate away from /login
  await expect(page).not.toHaveURL(/\/login/, { timeout: 8_000 });
});
