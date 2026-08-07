/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Team INVITE email input enforces
 * TDD Contract #10 value-domains at the client boundary, and hostile input renders
 * INERT (never executes). `team-interactions.spec.ts` covers empty/invalid/valid +
 * one <script> shape + seat-cap; THIS is the full value-domain sweep (boundary,
 * overlong, unicode, SQL/XSS/protocol injection) the mandate requires.
 *
 * Client-only assertions (NO POST — sending an invite is a real side effect): the
 * `team-invite-email-error` affordance + `aria-invalid` + submit-disabled reflect
 * `isValidEmail(inviteEmail())` after blur (`emailTouched`). Org-agnostic — the error
 * affordance depends only on email validity, never on seat state or a network call.
 *
 * Real session (E2E_API_KEY) + broad `/\/api\//` passthrough so the admin shell gets
 * real sites and mounts the org-scoped Team section (per gotcha 11 — a narrow
 * passthrough stubs /api/sites empty → "No sites" skeleton, child never mounts).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./team-interactions.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Real console errors + pageerrors, ignoring benign fixture/harness noise. */
function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

const email = (page: Page) => page.locator('[data-testid="team-invite-email"]');
const emailError = (page: Page) => page.locator('[data-testid="team-invite-email-error"]');
const submit = (page: Page) => page.locator('[data-testid="team-invite-submit"]');

/** Fill the invite email + blur — blur sets `emailTouched` so the error affordance can show. */
async function enter(page: Page, value: string): Promise<void> {
  const input = email(page);
  await input.fill(value);
  await input.press('Tab'); // blur → emailTouched.set(true)
}

const gotoTeam = async (page: Page): Promise<void> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/team', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="team-page"]').waitFor({ state: 'visible', timeout: 15000 });
  await email(page).waitFor({ state: 'visible', timeout: 10000 });
};

test.describe('Admin · Team invite email value-domains (P0-ADMIN)', () => {
  test('the Team section + invite form render authed (0 console errors)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    await gotoTeam(page);
    await expect(email(page), 'the invite email input renders').toBeVisible();
    await expect(submit(page), 'the send-invite button renders').toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/team-invite-form.png' });
    expect(errors, `must render with 0 console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('clearly-invalid emails surface the error affordance + disable submit; valid ones clear it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoTeam(page);

    const cases: Array<{ email: string; valid: boolean; label: string }> = [
      { email: 'teammate@example.com', valid: true, label: 'canonical valid' },
      { email: 'a@b.co', valid: true, label: 'minimal valid' },
      { email: '', valid: false, label: 'empty' },
      { email: '   ', valid: false, label: 'whitespace-only' },
      { email: 'notanemail', valid: false, label: 'no @' },
      { email: '@example.com', valid: false, label: 'no local part' },
      { email: 'has space@x.com', valid: false, label: 'internal space' },
    ];

    for (const c of cases) {
      await enter(page, c.email);
      if (c.valid) {
        await expect(emailError(page), `${c.label} (${JSON.stringify(c.email)}) accepted — error hidden`).toHaveCount(0);
        await expect(email(page), `${c.label} not flagged aria-invalid`).not.toHaveAttribute('aria-invalid', 'true');
      } else {
        await expect(emailError(page), `${c.label} (${JSON.stringify(c.email)}) shows the error affordance`).toBeVisible();
        await expect(email(page), `${c.label} flagged aria-invalid`).toHaveAttribute('aria-invalid', 'true');
        await expect(submit(page), `${c.label} keeps submit disabled`).toBeDisabled();
      }
    }
  });

  test('hostile input (XSS / SQL / protocol / unicode / overlong) renders inert — never executes or crashes', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss().catch(() => {});
    });
    await gotoTeam(page);

    const hostile = [
      `<script>alert('xss')</script>@x.com`,
      `<img src=x onerror=alert(1)>@x.com`,
      `'; DROP TABLE team_invites;--@x.com`,
      `javascript:alert(1)@x.com`,
      `tëst🎉@example.com`,
      `${'a'.repeat(300)}@example.com`,
    ];
    for (const payload of hostile) {
      await enter(page, payload);
      // The input holds the LITERAL text (Angular escapes interpolation — never parsed as HTML/JS).
      await expect(email(page), 'the input preserves the literal hostile value').toHaveValue(payload);
      // The Team section is still standing (no crash / error boundary).
      await expect(page.locator('[data-testid="team-page"]'), 'the section survives hostile input').toBeVisible();
    }
    expect(dialogFired, 'no injection payload fired a dialog (no script executed)').toBe(false);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'no error-boundary crash').toBe(false);
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/team-invite-hostile.png' });
    expect(errors, `0 console errors on hostile input — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
