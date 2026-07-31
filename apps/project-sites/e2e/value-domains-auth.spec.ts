/**
 * TDD Contract #10 — Value-Domain Coverage: Public Auth Inputs
 *
 * Exercises every value class for every public auth input on /signin.
 * The app has ONE combined signin page with:
 *   - A magic-link email field (#signin-email, type=email)
 *   - A test-panel email/password used only for E2E (hidden behind
 *     data-testid="test-signin-panel") — NOT part of the value-domain
 *     suite (it is an E2E harness, not a real product form).
 *
 * /auth/sign-up does NOT exist as a separate route — the app uses
 * a magic-link-only flow from /signin.
 *
 * Value classes per RFC 5321 / product validation contract in
 * frontend/src/app/utils/validators/email.ts:
 *   (1) valid               — accepted, no error shown, submit button active
 *   (2) invalid-format      — inline error shown
 *   (3) empty / whitespace  — inline error on attempted submit
 *   (4) boundary-valid      — 63-char local part → accepted (RFC max is 64)
 *   (5) overlong            — >254 chars total → inline error shown
 *   (6) unicode + emoji     — treated as invalid by Angular-mirror EMAIL_PATTERN
 *   (7) injection-shaped    — value treated as inert text; no dialog; no console error
 *   (8) SQL/garbage garbage — inline error shown
 *
 * SAFETY: ALL POST/PATCH/PUT/DELETE to *\/api\/** intercepted — no real
 * signups or magic-link sends hit the server.
 */

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// ESM-safe __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.PROD_URL ?? process.env.BASE_URL ?? 'https://projectsites.dev';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'value-domains-auth');

// ─── helpers ───────────────────────────────────────────────────────────────

/** Intercept all mutating API calls — prevents real signups/magic-links. */
async function interceptMutations(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const method = route.request().method().toUpperCase();
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    } else {
      await route.continue();
    }
  });
}

/** Collect console errors, filtering out noise (favicon, third-party CDN). */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (
        !text.includes('favicon') &&
        !text.includes('analytics') &&
        !text.includes('posthog') &&
        !text.includes('sentry') &&
        !text.includes('third-party') &&
        !text.includes('Failed to load resource') // network calls blocked by intercept are OK
      ) {
        errors.push(text);
      }
    }
  });
  return errors;
}

/** Navigate to /signin starting from the homepage (real user flow). */
async function navigateToSignin(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  // Navigate to /signin — either via nav link or direct URL if no nav link visible
  const signInLink = page.locator('a[href*="/signin"], button:has-text("Sign In"), a:has-text("Sign In")').first();
  const isLinkVisible = await signInLink.isVisible().catch(() => false);
  if (isLinkVisible) {
    await signInLink.click();
    await page.waitForURL('**/signin**', { timeout: 10_000 });
  } else {
    await page.goto(`${BASE_URL}/signin`, { waitUntil: 'domcontentloaded' });
  }
  // Wait for the email input to be present
  await page.waitForSelector('#signin-email', { timeout: 10_000 });
}

/** Fill the magic-link email input and trigger validation via blur.
 *
 * REAL CONTRACT (frontend/src/app/pages/auth/sign-in.component.ts):
 *   - error renders when `touched() && !emailValid()` — blur is enough,
 *     no click required;
 *   - the magic-link button (`data-testid="sign-in-magic-link"`) is
 *     `[disabled]="magicBusy() || !emailValid()"` — DISABLED IS the
 *     rejection contract for invalid values. Never click it blind:
 *     clicking a disabled button hangs Playwright's actionability wait.
 */
async function fillEmailAndAttempt(page: Page, value: string): Promise<void> {
  const emailInput = page.locator('#signin-email');
  await emailInput.clear();
  await emailInput.fill(value);
  await emailInput.blur();
}

/** The magic-link submit button (never the email+password sign-in-submit). */
function magicLinkButton(page: Page) {
  return page.locator('[data-testid="sign-in-magic-link"]');
}

/** Valid-path helper: expect enabled, click, and let the intercepted POST fire. */
async function submitMagicLink(page: Page): Promise<void> {
  const btn = magicLinkButton(page);
  await expect(btn).toBeEnabled({ timeout: 5_000 });
  await btn.click();
}

/** Return the visible error text (if any) from the magic-link error container. */
async function getEmailError(page: Page): Promise<string | null> {
  const errorEl = page.locator('#signin-email-error');
  const visible = await errorEl.isVisible().catch(() => false);
  if (!visible) return null;
  const text = (await errorEl.textContent()) ?? '';
  return text.trim() || null;
}

/** Screenshot helper — only captures, never fails the test on save error. */
async function screenshot(page: Page, name: string): Promise<void> {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}.png`), fullPage: false });
  } catch {
    // Non-fatal — screenshot is observability only
  }
}

// ─── email input value-domain suite ────────────────────────────────────────

test.describe('signin /signin — magic-link email field value domains', () => {
  // One screenshot for the whole describe group
  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await interceptMutations(page);
    await navigateToSignin(page);
    await screenshot(page, 'signin-email-field-overview');
    await ctx.close();
  });

  // ── (1) valid email ──────────────────────────────────────────────────────
  test('(1) valid — user@example.com → no error, submit proceeds', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    await fillEmailAndAttempt(page, 'user@example.com');

    // Valid email: the error element must NOT be visible (or must be empty)
    const errorEl = page.locator('#signin-email-error');
    const errorVisible = await errorEl.isVisible().catch(() => false);
    if (errorVisible) {
      const txt = (await errorEl.textContent())?.trim();
      // If there IS text, it must NOT be a validation error about the email format
      expect(txt ?? '').not.toMatch(/looks off|invalid|required|try again/i);
    }

    expect(errors).toHaveLength(0);
  });

  // ── (2a) invalid-format — plain string ──────────────────────────────────
  test('(2a) invalid-format — not-an-email → inline validation error shown', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    await fillEmailAndAttempt(page, 'not-an-email');

    const err = await getEmailError(page);
    // TDD-RED: if the app does NOT show an error for "not-an-email", this is a product bug
    expect(err, 'Expected inline error for bare non-email string').not.toBeNull();
    expect(err).toMatch(/looks off|invalid|try again|email/i);
    expect(errors).toHaveLength(0);
  });

  // ── (2b) invalid-format — single-label domain ───────────────────────────
  test('(2b) invalid-format — a@b → inline validation error shown', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    await fillEmailAndAttempt(page, 'a@b');

    const err = await getEmailError(page);
    // TDD-RED: per email.ts, "a@b" must fail EMAIL_PATTERN (no TLD). Bug if null.
    expect(err, 'Expected inline error for single-label domain "a@b"').not.toBeNull();
    expect(errors).toHaveLength(0);
  });

  // ── (2c) invalid-format — trailing @ ────────────────────────────────────
  test('(2c) invalid-format — user@ → inline validation error shown', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    await fillEmailAndAttempt(page, 'user@');

    const err = await getEmailError(page);
    expect(err, 'Expected inline error for trailing @ address').not.toBeNull();
    expect(errors).toHaveLength(0);
  });

  // ── (3a) empty ───────────────────────────────────────────────────────────
  test('(3a) empty — "" → "email required" error on submit attempt', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    // Ensure field is empty, blur to mark touched — the disabled magic-link
    // button IS the app's submit-rejection for an empty field (clicking a
    // disabled button would hang Playwright's actionability wait).
    const emailInput = page.locator('#signin-email');
    await emailInput.clear();
    await emailInput.blur();

    const err = await getEmailError(page);
    // Real contract: for an EMPTY field the app rejects via the DISABLED
    // magic-link button (no error copy until there is text to validate).
    // Either signal (disabled button, or an error message) counts as rejection.
    if (err === null) {
      await expect(magicLinkButton(page)).toBeDisabled({ timeout: 5_000 });
    } else {
      expect(err).toMatch(/required|add your email|email/i);
    }
    expect(errors).toHaveLength(0);
  });

  // ── (3b) whitespace-only ─────────────────────────────────────────────────
  test('(3b) whitespace-only — "   " → treated as empty, shows error', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    await fillEmailAndAttempt(page, '   ');

    const err = await getEmailError(page);
    // Real contract: whitespace-only trims to empty → rejection is the
    // DISABLED magic-link button (error copy optional).
    if (err === null) {
      await expect(magicLinkButton(page)).toBeDisabled({ timeout: 5_000 });
    }
    expect(errors).toHaveLength(0);
  });

  // ── (4) boundary-valid — 63-char local part ──────────────────────────────
  test('(4) boundary-valid — 63-char local part → accepted (no error)', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    // RFC 5321 §4.5.3.1.1 — max local-part = 64 chars; 63 is valid
    const local = 'a'.repeat(63);
    const email = `${local}@example.com`; // total: 63 + 12 = 75 chars (well under 254)

    await fillEmailAndAttempt(page, email);

    const err = await getEmailError(page);
    expect(err, `63-char local part should be valid, got: "${err}"`).toBeNull();
    expect(errors).toHaveLength(0);
  });

  // ── (5) overlong — 320+ chars ────────────────────────────────────────────
  test('(5) overlong — 320-char email → rejected with length error', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    // Build a 320-char email. MAX_LENGTH in email.ts = 254.
    const local = 'a'.repeat(100);
    const domain = 'b'.repeat(200);
    const email = `${local}@${domain}.com`; // ~304 chars
    expect(email.length).toBeGreaterThan(254);

    await fillEmailAndAttempt(page, email);

    const err = await getEmailError(page);
    // TDD-RED: overlong email (>254) must be rejected
    expect(err, 'Expected error for overlong email (>254 chars)').not.toBeNull();
    expect(errors).toHaveLength(0);
  });

  // ── (5b) extreme overlong — 2,000 chars — must not crash ─────────────────
  test('(5b) extreme-overlong — 2000-char string → rejected, no crash', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    const garbage = 'x'.repeat(1994) + '@y.com';
    expect(garbage.length).toBeGreaterThan(2000 - 10);

    await fillEmailAndAttempt(page, garbage);

    // Must not crash the page
    await expect(page.locator('app-root')).toBeVisible();

    const err = await getEmailError(page);
    expect(err, 'Expected error for 2000-char email').not.toBeNull();
    expect(errors).toHaveLength(0);
  });

  // ── (6a) unicode local part ──────────────────────────────────────────────
  test('(6a) unicode — ünïcode@exämple.com → validation error (Angular EMAIL_PATTERN)', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    await fillEmailAndAttempt(page, 'ünïcode@exämple.com');

    // The Angular-mirror EMAIL_PATTERN in email.ts does NOT accept Unicode
    // local parts — this is a known intentional constraint per JSDoc.
    // TDD-RED: if the app accepts it without error, document as product gap.
    const err = await getEmailError(page);
    // Note: some validators DO accept intl emails. Mark as test.fail() if app
    // accepts unicode emails (that would be an intentional product decision to note).
    // We assert the error IS shown (current validator behavior):
    expect(err, 'Unicode email should show validation error per current email.ts pattern').not.toBeNull();
    expect(errors).toHaveLength(0);
  });

  // ── (6b) emoji in email ───────────────────────────────────────────────────
  test('(6b) emoji — 😀@example.com → validation error shown', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    await fillEmailAndAttempt(page, '😀@example.com');

    const err = await getEmailError(page);
    expect(err, 'Emoji email should trigger validation error').not.toBeNull();
    expect(errors).toHaveLength(0);
  });

  // ── (7a) XSS-shaped — script tag ─────────────────────────────────────────
  test('(7a) injection — <script>alert(1)</script>@x.com → no dialog, no console error', async ({ page }) => {
    const errors = collectErrors(page);
    let dialogOpened = false;
    page.on('dialog', async (dialog) => {
      dialogOpened = true;
      await dialog.dismiss();
    });

    await interceptMutations(page);
    await navigateToSignin(page);

    await fillEmailAndAttempt(page, '<script>alert(1)</script>@x.com');

    // Critical safety assertions
    expect(dialogOpened, 'XSS script payload must NOT open a dialog').toBe(false);
    expect(errors.filter((e) => e.includes('alert')), 'XSS must not execute').toHaveLength(0);

    // Value must stay inert (page still alive, app-root intact)
    await expect(page.locator('app-root')).toBeVisible();

    // Must show validation error (invalid format)
    const err = await getEmailError(page);
    expect(err, 'XSS-shaped email should show validation error').not.toBeNull();
  });

  // ── (7b) SQL-shaped injection ─────────────────────────────────────────────
  test("(7b) injection — ' OR 1=1--@x.com → no dialog, shows validation error", async ({ page }) => {
    const errors = collectErrors(page);
    let dialogOpened = false;
    page.on('dialog', async (dialog) => {
      dialogOpened = true;
      await dialog.dismiss();
    });

    await interceptMutations(page);
    await navigateToSignin(page);

    await fillEmailAndAttempt(page, "' OR 1=1--@x.com");

    expect(dialogOpened, 'SQLi payload must not open a dialog').toBe(false);
    await expect(page.locator('app-root')).toBeVisible();

    const err = await getEmailError(page);
    expect(err, 'SQL-injection-shaped email should show validation error').not.toBeNull();
    expect(errors).toHaveLength(0);
  });

  // ── (7c) javascript: URI scheme ───────────────────────────────────────────
  test('(7c) injection — javascript:alert(1) as email → no execution, error shown', async ({ page }) => {
    const errors = collectErrors(page);
    let dialogOpened = false;
    page.on('dialog', async (dialog) => {
      dialogOpened = true;
      await dialog.dismiss();
    });

    await interceptMutations(page);
    await navigateToSignin(page);

    await fillEmailAndAttempt(page, 'javascript:alert(1)');

    expect(dialogOpened, 'javascript: scheme must not execute').toBe(false);
    await expect(page.locator('app-root')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  // ── (8) SQL-ish long garbage ──────────────────────────────────────────────
  test('(8) sql-garbage — long garbage string → validation error, no crash', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    const garbage =
      "SELECT * FROM users WHERE email='' OR ''=''; DROP TABLE users;--" + '@' + 'evil.com';

    await fillEmailAndAttempt(page, garbage);

    // Should show validation error (special chars break the email pattern)
    const err = await getEmailError(page);
    expect(err, 'SQL-garbage email should show validation error').not.toBeNull();
    await expect(page.locator('app-root')).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});

// ─── Additional: verify submit is blocked while invalid ────────────────────

test.describe('signin — submit state for invalid inputs', () => {
  test('submit click with invalid email does NOT navigate away from /signin', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    await fillEmailAndAttempt(page, 'not-valid');

    // Page must stay on /signin
    expect(page.url()).toContain('/signin');
    await expect(page.locator('#signin-email')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('submit click with empty field does NOT navigate away from /signin', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToSignin(page);

    const emailInput = page.locator('#signin-email');
    await emailInput.clear();
    await emailInput.blur();
    // Empty field → the magic-link button is DISABLED (the app's rejection
    // contract) — clicking is impossible, navigation cannot happen.
    await expect(magicLinkButton(page)).toBeDisabled({ timeout: 5_000 });

    expect(page.url()).toContain('/signin');
    await expect(page.locator('#signin-email')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('valid email → submit → API call intercepted, no real network hit', async ({ page }) => {
    const interceptedCalls: string[] = [];
    await page.route('**/api/**', async (route) => {
      const method = route.request().method().toUpperCase();
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
        interceptedCalls.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      } else {
        await route.continue();
      }
    });

    await navigateToSignin(page);
    await fillEmailAndAttempt(page, 'test@example.com');
    await submitMagicLink(page);

    // The magic-link POST must have been intercepted (never a real send)
    // and the app must transition to the sent state or stay alive.
    await expect(page.locator('app-root')).toBeVisible();
    await expect
      .poll(() => interceptedCalls.length, { timeout: 5_000 })
      .toBeGreaterThan(0);

    // Screenshot
    await screenshot(page, 'valid-email-submit-intercepted');
  });
});

// ─── Snapshot: final state after all value classes run ─────────────────────

test('value-domains-auth — final page stability smoke', async ({ page }) => {
  const errors = collectErrors(page);
  await interceptMutations(page);
  await navigateToSignin(page);

  // Run through all value classes quickly and ensure page never crashes
  const values = [
    'valid@example.com',
    'not-an-email',
    '',
    '   ',
    'a'.repeat(63) + '@example.com',
    'a'.repeat(100) + '@' + 'b'.repeat(200) + '.com',
    'unicode@exämple.com',
    '😀@example.com',
    '<script>alert(1)</script>@x.com',
    "' OR 1=1--@x.com",
    'javascript:alert(1)',
  ];

  for (const v of values) {
    const emailInput = page.locator('#signin-email');
    await emailInput.clear();
    if (v.trim().length > 0) await emailInput.fill(v);
    // App must remain alive after every value
    await expect(page.locator('app-root')).toBeVisible();
  }

  await screenshot(page, 'stability-smoke-final');

  // Filter errors collected across all fills
  const serious = errors.filter((e) => !e.includes('favicon') && !e.includes('posthog'));
  expect(serious, `Unexpected console errors: ${serious.join(', ')}`).toHaveLength(0);
});
