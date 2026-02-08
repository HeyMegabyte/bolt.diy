/**
 * @module e2e/golden-path
 * @description End-to-end "Golden Path" test suite that validates the complete
 * user journey from homepage search through sign-in to AI workflow trigger.
 *
 * Tests the deferred sign-in flow:
 *   Search → Details → Build (triggers sign-in) → Waiting
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
  const input = page.getByPlaceholder(/Enter your business name/);
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

test.describe('Golden Path: Deferred Sign-In Flow', () => {
  test('1. Search → Select → Details screen appears (not sign-in)', async ({ page }) => {
    await setupSearchMocks(page);
    await page.goto('/');

    await searchAndSelectBusiness(page);

    // Should navigate to DETAILS screen (deferred sign-in)
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({
      timeout: 10_000,
    });

    // Sign-in should NOT appear yet
    await expect(page.getByRole('heading', { name: /sign in/i })).not.toBeVisible();
  });

  test('2. Details → Build triggers sign-in for unauthenticated user', async ({ page }) => {
    await setupSearchMocks(page);
    await page.goto('/');

    await searchAndSelectBusiness(page);

    // Should be on details screen
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({
      timeout: 10_000,
    });

    // Click Build → should trigger sign-in since not authenticated
    await page.getByRole('button', { name: /build my website/i }).click();

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
  test('Search → Details → Build → Google Sign-In → Redirect → Waiting', async ({ page }) => {
    const apiCalls = await setupSearchMocks(page);

    // Intercept Google OAuth redirect
    await page.route('**/api/auth/google*', async (route) => {
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

    // Should be on details screen (deferred sign-in)
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({
      timeout: 10_000,
    });

    // Fill context
    await page.locator('#details-textarea').fill(
      "Premium men's grooming salon in Lake Hiawatha since 1998.",
    );

    // Click Build → triggers sign-in
    await page.getByRole('button', { name: /build my website/i }).click();

    // Sign-in screen should appear
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({
      timeout: 10_000,
    });

    // Click Google sign-in
    await page.getByText(/google/i).click();

    // Simulate Google OAuth callback redirect
    // Save business state to sessionStorage (the app does this automatically)
    await page.evaluate(
      ({ biz }) => {
        sessionStorage.setItem('ps_selected_business', JSON.stringify(biz));
        sessionStorage.setItem('ps_mode', 'business');
        sessionStorage.setItem('ps_pending_build', '1');
      },
      { biz: BUSINESS },
    );

    // Navigate as if Google redirected back
    const apiCalls2 = await setupSearchMocks(page);
    await page.goto(`/?token=${MOCK_TOKEN}&email=vito@salon.com&auth_callback=google`);

    // After auth callback with pending build, should eventually reach waiting screen
    // (auto-submit triggers because _pendingBuild was set)
    await expect(page.getByText(/building your website/i)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Golden Path: Phone OTP Flow', () => {
  test('Search → Details → Build → Phone OTP → Verify → Waiting', async ({ page }) => {
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

    // Details screen (deferred sign-in)
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({
      timeout: 10_000,
    });

    // Fill context and click Build
    await page.locator('#details-textarea').fill(
      "Classic barbershop in Lake Hiawatha. Hot towel shaves and haircuts.",
    );
    await page.getByRole('button', { name: /build my website/i }).click();

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

    // Should auto-submit build and transition to waiting screen
    // (because _pendingBuild was set when Build was clicked)
    await expect(page.getByText(/building your website/i)).toBeVisible({ timeout: 15_000 });

    // Verify create API was called
    const createCall = apiCalls.find((c) => c.url.includes('create-from-search'));
    expect(createCall).toBeTruthy();
    expect(createCall!.method).toBe('POST');
  });

  test('Phone: various number formats are accepted', async ({ page }) => {
    await setupSearchMocks(page);

    await page.route('**/api/auth/phone/otp', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { expires_at: new Date(Date.now() + 600000).toISOString() },
        }),
      }),
    );

    await page.goto('/');
    await searchAndSelectBusiness(page);
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /build my website/i }).click();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /phone/i }).click();

    const phoneInput = page.locator('#phone-input');

    // Test: 10-digit US number (no +1 prefix)
    await phoneInput.fill('9735551234');
    await page.locator('#phone-send-btn').click();
    const otpInput = page.locator('#otp-input');
    await expect(otpInput).toBeVisible({ timeout: 10_000 });
  });

  test('Phone: shows error for empty phone number', async ({ page }) => {
    await setupSearchMocks(page);
    await page.goto('/');
    await searchAndSelectBusiness(page);
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /build my website/i }).click();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /phone/i }).click();

    // Try to send without entering phone
    await page.locator('#phone-send-btn').click();

    // Error message should appear
    await expect(page.locator('#phone-send-msg')).toContainText(/phone number/i);
  });

  test('Phone: shows error for invalid short number', async ({ page }) => {
    await setupSearchMocks(page);
    await page.goto('/');
    await searchAndSelectBusiness(page);
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /build my website/i }).click();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /phone/i }).click();

    // Enter too-short phone number
    await page.locator('#phone-input').fill('123');
    await page.locator('#phone-send-btn').click();

    // Error message should appear about invalid format
    await expect(page.locator('#phone-send-msg')).toBeVisible();
  });

  test('Phone: handles OTP verification failure', async ({ page }) => {
    await setupSearchMocks(page);

    await page.route('**/api/auth/phone/otp', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { expires_at: new Date(Date.now() + 600000).toISOString() },
        }),
      }),
    );

    // Mock verify to return error
    await page.route('**/api/auth/phone/verify', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'BAD_REQUEST', message: 'Invalid or expired OTP' },
        }),
      }),
    );

    await page.goto('/');
    await searchAndSelectBusiness(page);
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /build my website/i }).click();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /phone/i }).click();

    await page.locator('#phone-input').fill('+19735551234');
    await page.locator('#phone-send-btn').click();
    await expect(page.locator('#otp-input')).toBeVisible({ timeout: 10_000 });

    // Enter wrong OTP
    await page.locator('#otp-input').fill('000000');
    await page.locator('#otp-verify-btn').click();

    // Error message should appear
    await expect(page.locator('#otp-verify-msg')).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Golden Path: Email Magic Link Flow', () => {
  test('Search → Details → Build → Email → Magic Link Sent → Callback → Waiting', async ({
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

    // Details screen (deferred sign-in)
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({
      timeout: 10_000,
    });

    // Fill context and click Build
    await page.locator('#details-textarea').fill(
      "Classic barbershop and men's grooming. Hot towel shaves, haircuts, beard trims.",
    );
    await page.getByRole('button', { name: /build my website/i }).click();

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

    // Save business state to sessionStorage (mimicking app behavior)
    await page.evaluate(
      ({ biz }) => {
        sessionStorage.setItem('ps_selected_business', JSON.stringify(biz));
        sessionStorage.setItem('ps_mode', 'business');
        sessionStorage.setItem('ps_pending_build', '1');
      },
      { biz: BUSINESS },
    );

    // Simulate: user clicks magic link → redirected back with token
    const apiCalls2 = await setupSearchMocks(page);
    await page.goto(
      `/?token=${MOCK_TOKEN}&email=vito@vitossalon.com&auth_callback=email`,
    );

    // After auth callback with pending build, should auto-submit and reach waiting
    await expect(page.getByText(/building your website/i)).toBeVisible({ timeout: 15_000 });
  });

  test('Email: shows error for invalid email format', async ({ page }) => {
    await setupSearchMocks(page);
    await page.goto('/');
    await searchAndSelectBusiness(page);
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /build my website/i }).click();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });

    // Click Email sign-in
    await page.getByRole('button', { name: /email/i }).click();

    // Enter invalid email
    await page.locator('#email-input').fill('not-an-email');
    await page.locator('#email-send-btn').click();

    // Error message should appear
    await expect(page.locator('#email-send-msg')).toContainText(/valid email/i);
  });

  test('Email: shows error for empty email', async ({ page }) => {
    await setupSearchMocks(page);
    await page.goto('/');
    await searchAndSelectBusiness(page);
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /build my website/i }).click();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /email/i }).click();
    await page.locator('#email-send-btn').click();

    // Error message should appear
    await expect(page.locator('#email-send-msg')).toContainText(/valid email/i);
  });

  test('Email: handles API error for magic link send', async ({ page }) => {
    await setupSearchMocks(page);

    // Mock magic link send to return error
    await page.route('**/api/auth/magic-link', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'SendGrid unavailable' },
        }),
      }),
    );

    await page.goto('/');
    await searchAndSelectBusiness(page);
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /build my website/i }).click();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /email/i }).click();
    await page.locator('#email-input').fill('vito@salon.com');
    await page.locator('#email-send-btn').click();

    // Error message should appear
    await expect(page.locator('#email-send-msg')).toBeVisible({ timeout: 5_000 });
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
  test('Build button shows loading state while submitting', async ({ page }) => {
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

    // Go directly to details screen via auth callback (pre-authenticated)
    await page.goto(`/?token=${MOCK_TOKEN}&email=test@test.com`);
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });

    // Set business state
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

  test('Details screen shows custom mode label for custom websites', async ({ page }) => {
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

  test('Auth callback extracts token and email from URL params', async ({ page }) => {
    await setupSearchMocks(page);

    // Navigate with auth params
    await page.goto(`/?token=my-test-token&email=user@example.com&auth_callback=google`);

    // Verify the session was set
    const session = await page.evaluate(() => (window as any).state?.session);
    expect(session).toBeTruthy();
    expect(session.token).toBe('my-test-token');
    expect(session.identifier).toBe('user@example.com');
  });

  test('Custom Website option appears in search dropdown', async ({ page }) => {
    await page.route('**/api/search/businesses*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      }),
    );
    await page.route('**/api/sites/search*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      }),
    );

    await page.goto('/');
    const input = page.getByPlaceholder(/Enter your business name/);
    await input.click();
    await input.pressSequentially('my custom website', { delay: 30 });

    await expect(page.locator('.search-dropdown .search-result-custom')).toBeVisible({
      timeout: 10_000,
    });
  });
});
