/**
 * TDD Contract #10 — Value-Domain Coverage: Team Invite Email Input
 *
 * Exercises every value class for the invite-email field on /admin/team.
 *
 * REAL CONTRACT (frontend/src/app/pages/admin/sections/team.component.ts):
 *   - `emailValid` = computed(() => isValidEmail(inviteEmail()))
 *   - `showEmailError` = computed(() => emailTouched() && !emailValid())
 *   - Invite button: [disabled]="inviting() || !emailValid()"   ← DISABLED-GATE
 *   - Inline error renders when `showEmailError()` is true under
 *     data-testid="team-invite-email-error"
 *
 * SSOT validator: frontend/src/app/utils/validators/email.ts
 *   - 254-char cap (RFC 5321)
 *   - ASCII-only EMAIL_PATTERN (mirrors Angular's Validators.email)
 *   - Unicode + emoji REJECTED by the pattern
 *
 * SAFETY: ALL mutations to *\/api\/** are intercepted (counter-based).
 *   /api/analytics/track is excluded from the mutation counter.
 *   /api/auth/organization/* stubs return 2 realistic members + 1 invitation.
 */

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { signInAsTestUser } from './helpers/auth.js';

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.PROD_URL ?? process.env.BASE_URL ?? 'https://projectsites.dev';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'value-domains-team-invite');

// ─── realistic stub data ────────────────────────────────────────────────────

const STUB_ORG = {
  id: 'e2e-org-001',
  name: 'E2E Test Org',
  members: [
    { id: 'm1', userId: 'u1', email: 'owner@example.com', role: 'owner', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'm2', userId: 'u2', email: 'admin@example.com', role: 'admin', createdAt: '2026-03-01T00:00:00Z' },
  ],
  invitations: [
    { id: 'inv1', email: 'pending@example.com', role: 'member', status: 'pending', expiresAt: '2027-01-01T00:00:00Z' },
  ],
};

// ─── helpers ────────────────────────────────────────────────────────────────

/** Register route stubs for team-page API calls.
 *
 * Must be called AFTER signInAsTestUser so our org-specific handlers are
 * registered last and therefore matched FIRST (Playwright checks routes in
 * reverse registration order).
 *
 * @returns { mutationCount } getter — increments on each non-analytics mutation.
 */
async function stubTeamApis(page: Page): Promise<{ getMutationCount: () => number }> {
  let mutationCount = 0;

  // NO generic **/api/** catch-all here — the signInAsTestUser helper owns that
  // layer (auth/me, sites[0], last-resort). This function registers ONLY the
  // org-specific handlers, AFTER the helper, so they win reverse-match priority
  // for org traffic while the helper keeps handling everything else. (A local
  // catch-all registered after the helper shadowed auth/me + sites and broke
  // the whole shell — Pass 8 lesson.)

  // Member + invitation traffic — realistic org data + mutation counting.
  // ⚠️ Pattern MUST be `organization/**` (with the slash). Playwright's glob
  // treats a mid-token `**` (as in `organization**`) as unable to cross `/`,
  // so it silently matches NOTHING under /organization/… and the helper's
  // **/api/** catch-all absorbs every call — the counter reads 0 forever.
  // Proven via urlMatches() (Pass 8): 'organization**' → false for
  // /api/auth/organization/invite-member; 'organization/**' → true.
  await page.route('**/api/auth/organization/**', async (route) => {
    const method = route.request().method().toUpperCase();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: STUB_ORG }),
      });
      return;
    }
    // POST mutations (invite, remove, cancel) — count + 200
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      mutationCount++;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: {} }),
    });
  });

  return { getMutationCount: () => mutationCount };
}

/** Collect relevant console errors (filter known noise). */
function collectErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (
        !t.includes('favicon') &&
        !t.includes('analytics') &&
        !t.includes('posthog') &&
        !t.includes('sentry') &&
        !t.includes('third-party') &&
        !t.toLowerCase().includes('failed to load resource') &&
        !t.includes('Failed to load resource')
      ) {
        errs.push(t);
      }
    }
  });
  return errs;
}

/** Navigate to the team page as an authenticated user.
 *
 * 1. Register stubs (before signInAsTestUser so our org-stub is highest-priority)
 * 2. signInAsTestUser (injects session, stubs core admin APIs)
 * 3. Navigate to /admin/team via the browser address bar (post-auth nav)
 * 4. Wait for the invite email input to be in the DOM
 */
async function gotoTeamPage(page: Page): Promise<{ getMutationCount: () => number }> {
  // ORDER MATTERS: signInAsTestUser FIRST. Routes match in REVERSE registration
  // order, so whatever registers LAST wins. The helper's last-resort catch-all
  // must sit BELOW our counting handlers — registering ours after the helper
  // means org calls (and the mutation counter) actually see the traffic.
  await signInAsTestUser(page);
  const { getMutationCount } = await stubTeamApis(page);
  await page.goto(`${BASE_URL}/admin/team`, { waitUntil: 'domcontentloaded' });
  // Scroll to ensure the form is in viewport (Angular renders async)
  await page.mouse.wheel(0, 200);
  await page.waitForSelector('[data-testid="team-invite-email"]', { timeout: 15_000 });
  return { getMutationCount };
}

/** Fill the invite email input and trigger validation via blur.
 *
 * Angular signals update on input; `emailTouched` is set on blur.
 * This mirrors how a real user fills and then tabs away.
 */
async function fillInviteEmail(page: Page, value: string): Promise<void> {
  const input = page.locator('[data-testid="team-invite-email"]');
  await input.clear();
  if (value.length > 0) {
    await input.fill(value);
  }
  await input.blur();
  // Small pause for Angular signals to propagate
  await page.waitForTimeout(150);
}

/** True when the inline error is visible (any non-empty text). */
async function hasEmailError(page: Page): Promise<boolean> {
  const el = page.locator('[data-testid="team-invite-email-error"]');
  const visible = await el.isVisible().catch(() => false);
  if (!visible) return false;
  const txt = (await el.textContent()) ?? '';
  return txt.trim().length > 0;
}

/** True when the submit button is disabled. */
async function isSubmitDisabled(page: Page): Promise<boolean> {
  const btn = page.locator('[data-testid="team-invite-submit"]');
  return btn.isDisabled();
}

/** The dual rejection signal: either inline error visible OR button disabled. */
async function isRejected(page: Page): Promise<boolean> {
  const err = await hasEmailError(page);
  const dis = await isSubmitDisabled(page);
  return err || dis;
}

/** Screenshot helper — non-fatal. */
async function screenshot(page: Page, name: string): Promise<void> {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}.png`), fullPage: false });
  } catch {
    // Non-fatal
  }
}

// ─── test suite ────────────────────────────────────────────────────────────

test.use({ serviceWorkers: 'block' });

test.describe('team invite email — value domains (disabled-gate contract)', () => {

  // ── (1) valid — canonical happy path ──────────────────────────────────────
  test('(1) valid — valid@example.com → button ENABLED, mutation intercepted', async ({ page }) => {
    const errors = collectErrors(page);
    const { getMutationCount } = await gotoTeamPage(page);

    await fillInviteEmail(page, 'valid@example.com');
    await screenshot(page, '01-valid-email');

    // No error shown for valid email
    const errVisible = await hasEmailError(page);
    expect(errVisible, '(1) valid email must NOT show inline error').toBe(false);

    // Button must be enabled (disabled-gate contract)
    const btn = page.locator('[data-testid="team-invite-submit"]');
    await expect(btn, '(1) submit button must be enabled for valid email').toBeEnabled({ timeout: 3_000 });

    // Click submit — mutation must be intercepted
    const preMutations = getMutationCount();
    await btn.click();
    // Poll — the POST fires async after Angular processes the click.
    await expect
      .poll(getMutationCount, { timeout: 5_000 })
      .toBeGreaterThan(preMutations);

    expect(errors, '(1) no console errors').toHaveLength(0);
  });

  // ── (2a) invalid-format — bare string without @ ───────────────────────────
  test('(2a) invalid-format — not-an-email → rejected (error or disabled)', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoTeamPage(page);

    await fillInviteEmail(page, 'not-an-email');
    await screenshot(page, '02a-invalid-no-at');

    const rejected = await isRejected(page);
    expect(rejected, '(2a) "not-an-email" must be rejected (error or disabled button)').toBe(true);

    expect(errors).toHaveLength(0);
  });

  // ── (2b) invalid-format — single-label domain ─────────────────────────────
  test('(2b) invalid-format — a@b → rejected (no TLD)', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoTeamPage(page);

    await fillInviteEmail(page, 'a@b');
    await screenshot(page, '02b-invalid-single-label');

    const rejected = await isRejected(page);
    expect(rejected, '(2b) "a@b" must be rejected by EMAIL_PATTERN').toBe(true);

    expect(errors).toHaveLength(0);
  });

  // ── (3a) empty — no input ─────────────────────────────────────────────────
  test('(3a) empty — untouched field → submit button disabled', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoTeamPage(page);

    // Do NOT fill anything — just try to observe the button state
    const btn = page.locator('[data-testid="team-invite-submit"]');
    const disabled = await btn.isDisabled();
    expect(disabled, '(3a) button must be disabled when email is empty').toBe(true);

    expect(errors).toHaveLength(0);
  });

  // ── (3b) whitespace-only — should be treated as empty ─────────────────────
  test('(3b) whitespace-only — spaces only → rejected', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoTeamPage(page);

    await fillInviteEmail(page, '   ');
    await screenshot(page, '03b-whitespace-only');

    const rejected = await isRejected(page);
    expect(rejected, '(3b) whitespace-only must be rejected (isValidEmail trims first)').toBe(true);

    expect(errors).toHaveLength(0);
  });

  // ── (4a) boundary-valid — exactly 254 chars ───────────────────────────────
  test('(4a) boundary-valid — 254-char email → accepted', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoTeamPage(page);

    // Build a 254-char email: local@domain.tld where total = 254
    const local = 'x'.repeat(242); // 242 chars
    const domain = 'example.com';  // 11 chars
    const email254 = `${local}@${domain}`; // 242 + 1 + 11 = 254 chars
    expect(email254.length).toBe(254);

    await fillInviteEmail(page, email254);
    await screenshot(page, '04a-boundary-254-valid');

    // 254 chars is exactly at the cap — must be accepted
    const btn = page.locator('[data-testid="team-invite-submit"]');
    const disabled = await btn.isDisabled();
    expect(disabled, '(4a) 254-char email must NOT be disabled (at cap, not over)').toBe(false);

    expect(errors).toHaveLength(0);
  });

  // ── (4b) boundary-invalid — exactly 255 chars ─────────────────────────────
  test('(4b) boundary-invalid — 255-char email → rejected (over 254-char cap)', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoTeamPage(page);

    const local = 'x'.repeat(243); // 243 chars
    const domain = 'example.com';  // 11 chars
    const email255 = `${local}@${domain}`; // 243 + 1 + 11 = 255 chars
    expect(email255.length).toBe(255);

    await fillInviteEmail(page, email255);
    await screenshot(page, '04b-boundary-255-rejected');

    const rejected = await isRejected(page);
    expect(rejected, '(4b) 255-char email must be rejected (exceeds 254-char cap)').toBe(true);

    expect(errors).toHaveLength(0);
  });

  // ── (5) overlong — 2000-char string → no crash ────────────────────────────
  test('(5) overlong — 2000-char string → rejected gracefully (no crash)', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoTeamPage(page);

    const overlong = 'x'.repeat(1990) + '@x.co';
    expect(overlong.length).toBeGreaterThan(254);

    await fillInviteEmail(page, overlong);
    await screenshot(page, '05-overlong-2000');

    const rejected = await isRejected(page);
    expect(rejected, '(5) 2000-char string must be rejected').toBe(true);

    // Critical: no crash or dialog
    expect(errors, '(5) must not throw a console error for overlong input').toHaveLength(0);
  });

  // ── (6a) unicode — non-ASCII local part → REJECTED (ASCII pattern) ─────────
  test('(6a) unicode — résumé@example.com → rejected (ASCII-only pattern)', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoTeamPage(page);

    await fillInviteEmail(page, 'résumé@example.com');
    await screenshot(page, '06a-unicode-local');

    const rejected = await isRejected(page);
    expect(
      rejected,
      '(6a) unicode local part rejected — EMAIL_PATTERN is ASCII-only (SSOT contract)',
    ).toBe(true);

    expect(errors).toHaveLength(0);
  });

  // ── (6b) emoji — 😀@example.com → REJECTED (ASCII pattern) ───────────────
  test('(6b) emoji — 😀@example.com → rejected (ASCII-only pattern)', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoTeamPage(page);

    await fillInviteEmail(page, '😀@example.com');
    await screenshot(page, '06b-emoji');

    const rejected = await isRejected(page);
    expect(rejected, '(6b) emoji address rejected — EMAIL_PATTERN is ASCII-only').toBe(true);

    expect(errors, '(6b) no console errors for emoji input').toHaveLength(0);
  });

  // ── (7a) injection — XSS-shaped → inert text, no dialog ──────────────────
  test('(7a) injection-shaped — XSS payload → treated as text, no dialog', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoTeamPage(page);

    const xss = '<script>alert(1)</script>@example.com';
    await fillInviteEmail(page, xss);
    await screenshot(page, '07a-xss-injection');

    // No dialog must appear
    let dialogFired = false;
    page.once('dialog', async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });
    await page.waitForTimeout(500);
    expect(dialogFired, '(7a) XSS-shaped input must not fire a dialog').toBe(false);

    // The value must be treated as a string — angle brackets fail EMAIL_PATTERN
    const rejected = await isRejected(page);
    expect(rejected, '(7a) XSS-shaped value must be rejected by EMAIL_PATTERN').toBe(true);

    expect(errors).toHaveLength(0);
  });

  // ── (7b) injection — SQLi-shaped → inert text, no dialog ─────────────────
  test("(7b) injection-shaped — SQL payload → treated as text, no dialog", async ({ page }) => {
    const errors = collectErrors(page);
    await gotoTeamPage(page);

    const sqli = "' OR '1'='1@example.com";
    await fillInviteEmail(page, sqli);
    await screenshot(page, '07b-sqli-injection');

    let dialogFired = false;
    page.once('dialog', async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });
    await page.waitForTimeout(500);
    expect(dialogFired, '(7b) SQLi-shaped input must not fire a dialog').toBe(false);

    expect(errors).toHaveLength(0);
  });

  // ── (8) valid submit → mutation intercepted ───────────────────────────────
  test('(8) valid submit — keyboard flow → invite POST intercepted', async ({ page }) => {
    const errors = collectErrors(page);

    // Register stubs FIRST so they are registered before signInAsTestUser's stubs.
    // In Playwright, last-registered route wins. signInAsTestUser registers a
    // catch-all **/api/**, so our org-specific stub must come after to win.
    // ORDER MATTERS: signInAsTestUser FIRST — its last-resort catch-all must sit
  // BELOW our counting handlers in reverse-match priority, or every mutation
  // lands in the helper and the counter reads zero.
  await signInAsTestUser(page);
    const { getMutationCount } = await stubTeamApis(page);
    await page.goto(`${BASE_URL}/admin/team`, { waitUntil: 'domcontentloaded' });
    await page.mouse.wheel(0, 200);
    await page.waitForSelector('[data-testid="team-invite-email"]', { timeout: 15_000 });

    const input = page.locator('[data-testid="team-invite-email"]');
    await input.click();
    await page.keyboard.type('newteammate@example.com');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    const btn = page.locator('[data-testid="team-invite-submit"]');
    await expect(btn, '(8) submit button must be enabled after valid input').toBeEnabled({ timeout: 3_000 });

    const pre = getMutationCount();
    await btn.click();
    // Poll — the POST fires async after Angular processes the click.
    await expect
      .poll(getMutationCount, { timeout: 5_000 })
      .toBeGreaterThan(pre);
    await screenshot(page, '08-valid-submit');

    expect(errors, '(8) no console errors on submit').toHaveLength(0);
  });
});
