/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the AI Env Vars manager (Settings → "AI Env
 * Vars", `<app-env-vars-manager scope="org">`) enforces the POSIX env-var KEY grammar
 * at the client boundary across TDD Contract #10 value-domains, and hostile input
 * renders INERT. env-vars had CRUD happy-path specs (`e2e/env-vars-*.spec.ts`) but NO
 * value-domain / real-prod admin-verify coverage of the key validator.
 *
 * KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/ (env-vars-manager.component.ts) — note it has NO
 * length cap (the server enforces length), so an overlong all-letters key is CLIENT-valid.
 * Client-only: the spec fills the KEY input and asserts the `ev-key-error` affordance +
 * `aria-invalid` + the Save button's disabled state; it NEVER submits (creating an env
 * var is a real mutation). Reach: /admin/settings → "AI Env Vars" tab → "+ Add variable".
 *
 * Broad `/\/api\//` passthrough so the admin shell mounts the org-scoped Settings section.
 * @see {@link ../helpers/realdata.ts}
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

const keyInput = (page: Page) => page.locator('[aria-label="Variable key"]');
const keyError = (page: Page) => page.locator('[data-testid="ev-key-error"]');
const saveBtn = (page: Page) => page.getByRole('button', { name: /save variable/i });

/** Reach the env-vars ADD form: Settings → "AI Env Vars" tab → "+ Add variable" opener. */
const openEnvVarForm = async (page: Page): Promise<void> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
  await page.getByText(/AI Env Vars/i).first().click(); // activate the tab (label is exact)
  // The opener's accessible name is its aria-label ("Add a new environment variable"),
  // NOT the visible "+ Add variable" text — target the aria-label directly.
  const addBtn = page.locator('[aria-label="Add a new environment variable"]');
  await addBtn.waitFor({ state: 'visible', timeout: 12000 });
  await addBtn.click();
  await keyInput(page).waitFor({ state: 'visible', timeout: 10000 });
};

test.describe('Admin · AI Env Vars key value-domains (P0-ADMIN)', () => {
  test('Settings → AI Env Vars → Add variable reveals the key/value form (0 console errors)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    await openEnvVarForm(page);
    await expect(keyInput(page), 'the Variable key input renders').toBeVisible();
    await expect(saveBtn(page), 'the Save button renders').toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/env-vars-add-form.png' });
    expect(errors, `must render with 0 console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('the POSIX key grammar accepts valid identifiers and flags malformed ones (error + disabled Save)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await openEnvVarForm(page);
    const key = keyInput(page);

    const cases: Array<{ key: string; valid: boolean; label: string }> = [
      { key: 'API_TOKEN', valid: true, label: 'canonical' },
      { key: '_private', valid: true, label: 'leading underscore' },
      { key: 'a', valid: true, label: 'single letter' },
      { key: 'X9_y', valid: true, label: 'letters+digits+underscore' },
      { key: 'A'.repeat(120), valid: true, label: 'overlong all-letters (no client length cap — server enforces)' },
      { key: '1ABC', valid: false, label: 'leading digit' },
      { key: 'has-dash', valid: false, label: 'hyphen' },
      { key: 'has space', valid: false, label: 'space' },
      { key: 'has.dot', valid: false, label: 'dot' },
      { key: 'KEY!', valid: false, label: 'punctuation' },
      { key: '$HOME', valid: false, label: 'dollar sign' },
      { key: 'KÉY', valid: false, label: 'accented unicode' },
      { key: '키', valid: false, label: 'non-latin unicode' },
    ];
    for (const c of cases) {
      await key.fill(c.key);
      if (c.valid) {
        await expect(keyError(page), `${c.label} accepted — no error`).toHaveCount(0);
        await expect(key, `${c.label} not aria-invalid`).not.toHaveAttribute('aria-invalid', 'true');
        await expect(saveBtn(page), `${c.label} enables Save`).toBeEnabled();
      } else {
        await expect(keyError(page), `${c.label} (${JSON.stringify(c.key)}) shows the key error`).toBeVisible();
        await expect(key, `${c.label} flagged aria-invalid`).toHaveAttribute('aria-invalid', 'true');
        await expect(saveBtn(page), `${c.label} disables Save`).toBeDisabled();
      }
    }

    // Empty is "required" (not "invalid"): no error affordance, but Save stays disabled.
    await key.fill('');
    await expect(keyError(page), 'empty key shows no invalid-error (required, not malformed)').toHaveCount(0);
    await expect(saveBtn(page), 'empty key keeps Save disabled').toBeDisabled();
  });

  test('hostile key input (XSS / SQL / template) renders inert — never executes or crashes; Save stays disabled', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss().catch(() => {});
    });
    await openEnvVarForm(page);
    const key = keyInput(page);

    // Every payload contains a char outside [A-Za-z0-9_] → malformed → Save disabled.
    const hostile = [
      `<script>alert('xss')</script>`,
      `<img src=x onerror=alert(1)>`,
      `'; DROP TABLE ai_env_vars;--`,
      `\${INJECT}`,
    ];
    for (const payload of hostile) {
      await key.fill(payload);
      await expect(key, 'the key input preserves the literal hostile value').toHaveValue(payload);
      await expect(saveBtn(page), 'a malformed hostile key keeps Save disabled').toBeDisabled();
    }
    expect(dialogFired, 'no key payload fired a dialog (no script executed)').toBe(false);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'no error-boundary crash').toBe(false);
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/env-vars-hostile-key.png' });
    expect(errors, `0 console errors on hostile input — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
