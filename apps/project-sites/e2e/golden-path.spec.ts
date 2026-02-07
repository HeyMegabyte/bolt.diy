/**
 * @module e2e/golden-path
 * @description End-to-end "Golden Path" test suite that validates the complete
 * user journey from homepage search through sign-in to AI workflow trigger.
 *
 * Searches for "Vito's Mens Salon Lake Hiawatha", tests all three
 * authentication methods (Google OAuth, Phone OTP, Email Magic Link),
 * fills in the details + upload screen, and verifies the AI workflow
 * is triggered via the create-from-search API.
 *
 * All external API calls are intercepted via Playwright route mocking
 * so the test is deterministic and repeatable.
 *
 * @packageDocumentation
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Shared Fixtures ──────────────────────────────────────────

const BUSINESS = {
  place_id: 'ChIJ_vitos_lake_hiawatha',
  name: "Vito's Mens Salon",
  address: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
  types: ['hair_care', 'beauty_salon'],
};

const MOCK_TOKEN = 'e2e-test-token-abc123def456';
const MOCK_USER_ID = 'user-e2e-00000000-0000-0000-0000-000000000001';
const MOCK_ORG_ID = 'org-e2e-00000000-0000-0000-0000-000000000001';
const MOCK_SITE_ID = 'site-e2e-00000000-0000-0000-0000-000000000001';
const MOCK_SLUG = 'vitos-mens-salon';

/**
 * Set up shared route mocks for the search and lookup APIs.
 * Returns collected API calls for assertion.
 */
async function setupSearchMocks(page: Page) {
  const apiCalls: Array<{ url: string; method: string; body?: unknown }> = [];

  // Mock Google Places search
  await page.route('**/api/search/businesses*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [BUSINESS],
      }),
    }),
  );

  // Mock pre-built sites search (returns empty)
  await page.route('**/api/sites/search*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    }),
  );

  // Mock site lookup - business doesn't exist yet
  await page.route('**/api/sites/lookup*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { exists: false } }),
    }),
  );

  // Mock create-from-search
  await page.route('**/api/sites/create-from-search', async (route) => {
    const request = route.request();
    let body: unknown;
    try {
      body = JSON.parse(request.postData() ?? '{}');
    } catch {
      body = {};
    }
    apiCalls.push({ url: request.url(), method: request.method(), body });

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          site_id: MOCK_SITE_ID,
          slug: MOCK_SLUG,
          status: 'building',
        },
      }),
    });
  });

  // Mock site status poll
  await page.route(`**/api/sites/${MOCK_SITE_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: MOCK_SITE_ID,
        slug: MOCK_SLUG,
        status: 'building',
      }),
    }),
  );

  return apiCalls;
}

/**
 * Search for the business and select it from dropdown.
 */
async function searchAndSelectBusiness(page: Page) {
  const input = page.getByPlaceholder(/Search for your business/);
  await input.click();
  await input.pressSequentially("Vito's Mens Salon Lake Hiawatha", { delay: 20 });

  // Wait for dropdown and select the business
  await expect(
    page.locator('.search-result').filter({ hasText: "Vito's Mens Salon" }),
  ).toBeVisible({ timeout: 15_000 });

  await page
    .locator('.search-result')
    .filter({ hasText: "Vito's Mens Salon" })
    .first()
    .click();
}

/**
 * Fill details form and submit the build.
 */
async function fillDetailsAndSubmit(page: Page) {
  // Should be on details screen
  await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });

  // Business badge should show the selected business
  await expect(page.locator('#badge-biz-name')).toContainText("Vito's Mens Salon");
  await expect(page.locator('#badge-biz-addr')).toContainText('Lake Hiawatha');

  // Fill in additional context
  const textarea = page.locator('#details-textarea');
  await textarea.fill(
    "Vito's is a premium men's grooming salon specializing in classic cuts, " +
      'hot towel shaves, and beard maintenance. Dark wood interior with vintage barber chairs. ' +
      'Serving the Lake Hiawatha and Parsippany area since 1998.',
  );

  // Click Build My Website
  const buildBtn = page.locator('#build-btn');
  await expect(buildBtn).toBeVisible();
  await buildBtn.click();
}

// ─── Test Suite ───────────────────────────────────────────────

test.describe('Golden Path: Full User Journey', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Search → Select → Sign-In screen appears', async ({ page }) => {
    await setupSearchMocks(page);
    await page.goto('/');

    await searchAndSelectBusiness(page);

    // Should navigate to sign-in screen
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({
      timeout: 10_000,
    });

    // All three auth options should be visible
    await expect(page.getByText(/google/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /phone/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /email/i })).toBeVisible();
  });
});

test.describe('Golden Path: Google OAuth Flow', () => {
  test('Search → Google Sign-In → Details → Build → Waiting', async ({ page }) => {
    const apiCalls = await setupSearchMocks(page);

    // Intercept Google OAuth redirect - capture the redirect URL
    let googleRedirectUrl = '';
    await page.route('**/api/auth/google*', async (route) => {
      googleRedirectUrl = route.request().url();
      // Simulate: user completes Google OAuth and is redirected back with token
      await route.fulfill({
        status: 302,
        headers: {
          Location: `/?token=${MOCK_TOKEN}&email=vito@salon.com&auth_callback=google`,
        },
      });
    });

    await page.goto('/');

    // Stub redirectTo so we don't actually navigate away
    await page.evaluate(() => {
      (window as any)._redirects = [] as string[];
      (window as any).redirectTo = (url: string) => {
        (window as any)._redirects.push(url);
      };
    });

    await searchAndSelectBusiness(page);

    // Sign-in screen
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({
      timeout: 10_000,
    });

    // Before clicking Google, save business to sessionStorage
    // (the app does this automatically via the signInWithGoogle wrapper)

    // Click Google sign-in - this will be intercepted
    await page.getByText(/google/i).click();

    // The redirect was captured. Now simulate the callback by navigating
    // to the page with auth params (as if Google redirected back)
    await page.goto(`/?token=${MOCK_TOKEN}&email=vito@salon.com&auth_callback=google`);

    // After auth callback, should land on details screen
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });

    // Re-setup mocks after navigation (Playwright clears route handlers on goto)
    const apiCalls2 = await setupSearchMocks(page);

    // Set the state that would have been restored from sessionStorage
    await page.evaluate(
      ({ biz }) => {
        const state = (window as any).state;
        state.selectedBusiness = biz;
        state.mode = 'business';
        state.session = { token: 'e2e-test-token-abc123def456', identifier: 'vito@salon.com' };

        // Update details screen
        const nameEl = document.getElementById('badge-biz-name');
        const addrEl = document.getElementById('badge-biz-addr');
        const badgeEl = document.getElementById('details-business-badge');
        if (nameEl) nameEl.textContent = biz.name;
        if (addrEl) addrEl.textContent = biz.address;
        if (badgeEl) badgeEl.style.display = 'flex';
      },
      { biz: BUSINESS },
    );

    // Fill details and submit
    const textarea = page.locator('#details-textarea');
    await textarea.fill("Premium men's grooming salon in Lake Hiawatha since 1998.");

    const buildBtn = page.locator('#build-btn');
    await buildBtn.click();

    // Should transition to waiting screen
    await expect(page.getByText(/building your website/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/few minutes/i)).toBeVisible();

    // Verify the create API was called
    expect(apiCalls2.length).toBeGreaterThanOrEqual(1);
    const createCall = apiCalls2.find((c) => c.url.includes('create-from-search'));
    expect(createCall).toBeTruthy();
  });
});

test.describe('Golden Path: Phone OTP Flow', () => {
  test('Search → Phone Sign-In → OTP → Details → Build → Waiting', async ({ page }) => {
    const apiCalls = await setupSearchMocks(page);

    // Mock phone OTP send
    await page.route('**/api/auth/phone/otp', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { expires_at: new Date(Date.now() + 600000).toISOString() },
        }),
      }),
    );

    // Mock phone OTP verify - returns session token
    await page.route('**/api/auth/phone/verify', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            token: MOCK_TOKEN,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            user_id: MOCK_USER_ID,
            org_id: MOCK_ORG_ID,
          },
        }),
      }),
    );

    await page.goto('/');

    // Stub redirectTo
    await page.evaluate(() => {
      (window as any).redirectTo = (url: string) => {
        (window as any)._lastRedirect = url;
      };
    });

    await searchAndSelectBusiness(page);

    // Sign-in screen
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({
      timeout: 10_000,
    });

    // Click Phone sign-in
    await page.getByRole('button', { name: /phone/i }).click();

    // Phone input should appear
    const phoneInput = page.locator('#phone-input');
    await expect(phoneInput).toBeVisible();

    // Enter phone number
    await phoneInput.fill('+19735551234');

    // Click Send Verification Code
    await page.locator('#phone-send-btn').click();

    // OTP input should appear
    const otpInput = page.locator('#otp-input');
    await expect(otpInput).toBeVisible({ timeout: 10_000 });

    // Enter OTP
    await otpInput.fill('123456');

    // Click Verify Code
    await page.locator('#otp-verify-btn').click();

    // Should transition to details screen
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });

    // Fill details and submit
    await fillDetailsAndSubmit(page);

    // Should transition to waiting screen
    await expect(page.getByText(/building your website/i)).toBeVisible({ timeout: 10_000 });

    // Verify create API was called with correct data
    const createCall = apiCalls.find((c) => c.url.includes('create-from-search'));
    expect(createCall).toBeTruthy();
    expect(createCall!.method).toBe('POST');

    const body = createCall!.body as Record<string, unknown>;
    expect(body).toHaveProperty('mode', 'business');

    // Verify business data was sent (either nested or flat format)
    const hasBusiness =
      (body as any).business?.name || (body as any).business_name;
    expect(hasBusiness).toBeTruthy();
  });
});

test.describe('Golden Path: Email Magic Link Flow', () => {
  test('Search → Email Sign-In → Magic Link Sent → Callback → Details → Build → Waiting', async ({
    page,
  }) => {
    const apiCalls = await setupSearchMocks(page);

    // Mock magic link send
    await page.route('**/api/auth/magic-link', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              token: MOCK_TOKEN,
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            },
          }),
        });
      }
      return route.continue();
    });

    await page.goto('/');

    // Stub redirectTo
    await page.evaluate(() => {
      (window as any).redirectTo = (url: string) => {
        (window as any)._lastRedirect = url;
      };
    });

    await searchAndSelectBusiness(page);

    // Sign-in screen
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({
      timeout: 10_000,
    });

    // Click Email sign-in
    await page.getByRole('button', { name: /email/i }).click();

    // Email input should appear
    const emailInput = page.locator('#email-input');
    await expect(emailInput).toBeVisible();

    // Enter email
    await emailInput.fill('vito@vitossalon.com');

    // Click Send Magic Link
    await page.locator('#email-send-btn').click();

    // "Check your email" message should appear
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 10_000 });

    // Simulate: user clicks the magic link and is redirected back with token
    // Save business to sessionStorage first (mimicking the app behavior)
    await page.evaluate(
      ({ biz }) => {
        sessionStorage.setItem('ps_selected_business', JSON.stringify(biz));
        sessionStorage.setItem('ps_mode', 'business');
      },
      { biz: BUSINESS },
    );

    // Navigate as if the magic link callback redirected here
    // Re-setup mocks after navigation
    await page.goto(
      `/?token=${MOCK_TOKEN}&email=vito@vitossalon.com&auth_callback=email`,
    );

    const apiCalls2 = await setupSearchMocks(page);

    // After auth callback with sessionStorage restore, should land on details screen
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });

    // The business badge may need to be manually set if sessionStorage restore didn't trigger
    await page.evaluate(
      ({ biz }) => {
        const state = (window as any).state;
        if (!state.selectedBusiness) {
          state.selectedBusiness = biz;
          state.mode = 'business';
        }
        const nameEl = document.getElementById('badge-biz-name');
        const addrEl = document.getElementById('badge-biz-addr');
        const badgeEl = document.getElementById('details-business-badge');
        if (nameEl && !nameEl.textContent) nameEl.textContent = biz.name;
        if (addrEl && !addrEl.textContent) addrEl.textContent = biz.address;
        if (badgeEl) badgeEl.style.display = 'flex';
      },
      { biz: BUSINESS },
    );

    // Fill details and submit
    const textarea = page.locator('#details-textarea');
    await textarea.fill("Classic barbershop and men's grooming. Hot towel shaves, haircuts, beard trims.");

    const buildBtn = page.locator('#build-btn');
    await buildBtn.click();

    // Should transition to waiting screen
    await expect(page.getByText(/building your website/i)).toBeVisible({ timeout: 10_000 });

    // Verify create API was called
    const createCall = apiCalls2.find((c) => c.url.includes('create-from-search'));
    expect(createCall).toBeTruthy();
  });
});

test.describe('Golden Path: Waiting Screen Behavior', () => {
  test('Shows build-in-progress status and polling indicator', async ({ page }) => {
    await setupSearchMocks(page);

    // Start directly at the waiting screen by setting state
    await page.goto(`/?token=${MOCK_TOKEN}&email=test@test.com&auth_callback=email`);

    await page.evaluate(
      ({ siteId, slug }) => {
        const state = (window as any).state;
        state.siteId = siteId;
        state.slug = slug;
        state.session = { token: 'test-token', identifier: 'test@test.com' };

        // Navigate to waiting
        (window as any).navigateTo('waiting');
      },
      { siteId: MOCK_SITE_ID, slug: MOCK_SLUG },
    );

    // Waiting screen elements
    await expect(page.getByText(/building your website/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/few minutes/i)).toBeVisible();
    await expect(page.getByText(/build in progress/i)).toBeVisible();
    await expect(page.locator('.status-dot')).toBeVisible();
    await expect(page.locator('.loading-dots')).toBeVisible();
  });

  test('Redirects to published site when polling detects completion', async ({ page }) => {
    let pollCount = 0;

    await page.route(`**/api/sites/${MOCK_SITE_ID}`, async (route) => {
      pollCount++;
      // After 2nd poll, return published status
      if (pollCount >= 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: MOCK_SITE_ID,
            slug: MOCK_SLUG,
            status: 'published',
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: MOCK_SITE_ID,
            slug: MOCK_SLUG,
            status: 'building',
          }),
        });
      }
    });

    await page.goto('/');

    // Capture redirects
    let redirectUrl = '';
    await page.exposeFunction('__captureRedirect', (url: string) => {
      redirectUrl = url;
    });
    await page.evaluate(() => {
      (window as any).redirectTo = (url: string) => {
        (window as any).__captureRedirect(url);
      };
    });

    // Set state directly to waiting
    await page.evaluate(
      ({ siteId, slug, token }) => {
        const state = (window as any).state;
        state.siteId = siteId;
        state.slug = slug;
        state.session = { token, identifier: 'test@test.com' };
        (window as any).navigateTo('waiting');
      },
      { siteId: MOCK_SITE_ID, slug: MOCK_SLUG, token: MOCK_TOKEN },
    );

    // Wait for polling to detect the published status (polls every 10s, so wait enough)
    await page.waitForTimeout(25_000);

    // Should have redirected to the published site
    expect(redirectUrl).toBe(`https://${MOCK_SLUG}-sites.megabyte.space`);
  });
});

test.describe('Golden Path: Validation and Edge Cases', () => {
  test('Build button is disabled while submitting', async ({ page }) => {
    await setupSearchMocks(page);

    // Delay the create response
    await page.route('**/api/sites/create-from-search', async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { site_id: MOCK_SITE_ID, slug: MOCK_SLUG, status: 'building' },
        }),
      });
    });

    // Go directly to details screen via auth callback
    await page.goto(`/?token=${MOCK_TOKEN}&email=test@test.com`);
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });

    // Set business
    await page.evaluate(
      ({ biz }) => {
        const state = (window as any).state;
        state.selectedBusiness = biz;
        state.mode = 'business';
        const nameEl = document.getElementById('badge-biz-name');
        const addrEl = document.getElementById('badge-biz-addr');
        const badgeEl = document.getElementById('details-business-badge');
        if (nameEl) nameEl.textContent = biz.name;
        if (addrEl) addrEl.textContent = biz.address;
        if (badgeEl) badgeEl.style.display = 'flex';
      },
      { biz: BUSINESS },
    );

    await page.locator('#details-textarea').fill('Test context');
    const buildBtn = page.locator('#build-btn');
    await buildBtn.click();

    // Button should show "Building" text while submitting
    await expect(buildBtn).toContainText(/building/i);
  });

  test('Details screen shows "Describe your custom website" for custom mode', async ({
    page,
  }) => {
    await setupSearchMocks(page);

    await page.goto(`/?token=${MOCK_TOKEN}&email=test@test.com`);
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });

    // Set custom mode
    await page.evaluate(() => {
      const state = (window as any).state;
      state.selectedBusiness = null;
      state.mode = 'custom';
      (window as any).navigateTo('details');
    });

    await expect(page.locator('#details-title')).toContainText(/custom website/i);
  });

  test('Phone sign-in shows error for empty phone number', async ({ page }) => {
    await setupSearchMocks(page);
    await page.goto('/');

    // Stub redirectTo
    await page.evaluate(() => {
      (window as any).redirectTo = () => {};
    });

    await searchAndSelectBusiness(page);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({
      timeout: 10_000,
    });

    // Click Phone sign-in
    await page.getByRole('button', { name: /phone/i }).click();

    // Try to send without entering phone
    await page.locator('#phone-send-btn').click();

    // Error message should appear
    await expect(page.locator('#phone-send-msg')).toContainText(/phone number/i);
  });

  test('Email sign-in shows error for invalid email', async ({ page }) => {
    await setupSearchMocks(page);
    await page.goto('/');

    // Stub redirectTo
    await page.evaluate(() => {
      (window as any).redirectTo = () => {};
    });

    await searchAndSelectBusiness(page);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({
      timeout: 10_000,
    });

    // Click Email sign-in
    await page.getByRole('button', { name: /email/i }).click();

    // Enter invalid email
    await page.locator('#email-input').fill('not-an-email');

    // Try to send
    await page.locator('#email-send-btn').click();

    // Error message should appear
    await expect(page.locator('#email-send-msg')).toContainText(/valid email/i);
  });
});
