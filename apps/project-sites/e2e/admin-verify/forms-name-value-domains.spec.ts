/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Forms prompt-designer TEST panel's
 * `form_name` slug input enforces its grammar across TDD Contract #10 value-domains.
 * `forms-interactions.spec.ts` opens the designer; `forms-submissions-filter.spec.ts`
 * covers the inbox filters; THIS covers the form_name validation affordance.
 *
 * Reach: /admin/forms → "Edit prompt" (`forms-open-prompt-designer`) opens the
 * fullscreen designer whose right pane is the tester (`forms-test-form-name`). Slug rule
 * (forms.component.ts): /^[a-z0-9][a-z0-9-_]{0,62}$/i (first char alnum, ≤64 total).
 * `forms-test-name-hint` shows when `formNameInvalid()`; `forms-test-run` is disabled on it.
 *
 * Client-only — the spec fills the name + asserts the hint + run-disabled state; it NEVER
 * clicks Run (a test submission is a real side effect). Org-agnostic.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./forms-interactions.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

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

const nameInput = (page: Page) => page.locator('[data-testid="forms-test-form-name"]');
const runBtn = (page: Page) => page.locator('[data-testid="forms-test-run"]');

/** Reach the designer's test panel: /admin/forms → open the prompt designer overlay. */
const openTester = async (page: Page): Promise<void> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/forms', { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('heading', { name: /submissions/i })
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
  // Two elements carry this testid (the header button + an empty-state CTA when the org
  // has no forms) — the header one is DOM-first and always present; both open the designer.
  await page.locator('[data-testid="forms-open-prompt-designer"]').first().click();
  await nameInput(page).waitFor({ state: 'visible', timeout: 12000 });
};

test.describe('Admin · Forms test-panel form_name value-domains (P0-ADMIN)', () => {
  test('the prompt designer opens its test panel (form_name + Run render, 0 console errors)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    await openTester(page);
    await expect(nameInput(page), 'the form_name input renders').toBeVisible();
    await expect(runBtn(page), 'the Run test button renders').toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/forms-designer-tester.png' });
    expect(errors, `must render with 0 console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('the slug grammar accepts valid form names and flags malformed ones (hint + disabled Run)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await openTester(page);
    const name = nameInput(page);

    const cases: Array<{ name: string; valid: boolean; label: string }> = [
      { name: 'newsletter', valid: true, label: 'canonical' },
      { name: 'contact', valid: true, label: 'word' },
      { name: 'my-form_2', valid: true, label: 'dash+underscore+digit' },
      { name: 'X9', valid: true, label: 'uppercase (case-insensitive)' },
      { name: '-leading', valid: false, label: 'leading dash' },
      { name: 'has space', valid: false, label: 'space' },
      { name: 'has.dot', valid: false, label: 'dot' },
      { name: 'bad!', valid: false, label: 'punctuation' },
      { name: 'café', valid: false, label: 'accented unicode' },
      { name: 'x'.repeat(70), valid: false, label: 'overlong (>64)' },
    ];
    for (const c of cases) {
      await name.fill(c.name);
      // The designer's tester exposes validity via the Run button's disabled state (the
      // standalone slug hint lives in the legacy inline tester, not this overlay panel).
      if (c.valid) {
        await expect(runBtn(page), `${c.label} (${JSON.stringify(c.name)}) enables Run`).toBeEnabled();
      } else {
        await expect(runBtn(page), `${c.label} (${JSON.stringify(c.name)}) disables Run`).toBeDisabled();
      }
    }
  });

  test('hostile form_name (XSS / SQL / template) renders inert — never executes; Run stays disabled', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss().catch(() => {});
    });
    await openTester(page);
    const name = nameInput(page);

    const hostile = [`<script>alert('x')</script>`, `'; DROP TABLE form_submissions;--`, `\${INJECT}`, `<img src=x onerror=alert(1)>`];
    for (const payload of hostile) {
      await name.fill(payload);
      await expect(name, 'the input preserves the literal hostile value').toHaveValue(payload);
      await expect(runBtn(page), 'a malformed hostile name keeps Run disabled').toBeDisabled();
    }
    expect(dialogFired, 'no payload fired a dialog (no script executed)').toBe(false);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'no error-boundary crash').toBe(false);
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/forms-name-hostile.png' });
    expect(errors, `0 console errors on hostile input — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
