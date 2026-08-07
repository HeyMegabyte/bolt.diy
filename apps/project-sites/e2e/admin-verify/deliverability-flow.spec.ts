/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Deliverability checker (`/admin/deliverability`).
 * The section renders regardless of its `email_deliverability_wizard` flag (only the Check action
 * is flag-gated). Two tests:
 *   1. value-domain (Contract #10, flag-INDEPENDENT): the bare-domain validity hint reacts to
 *      protocol/spaced input vs a valid bare domain — no network call;
 *   2. check → result flow (flag-gated): when the flag is on (Check enabled for a valid domain),
 *      run a stubbed check and assert the `deliverability-result` renders; SKIP gracefully when
 *      the beta flag is dark (Check stays disabled) — never a false red.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./deliverability-error-state.spec.ts}
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

test.describe('Admin · Deliverability checker (P0-ADMIN)', () => {
  test('the bare-domain input validity hint reacts across the value domain (no network call)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/deliverability', { waitUntil: 'domcontentloaded' });

    const input = page.locator('[data-testid="deliverability-domain"]');
    const hint = page.locator('[data-testid="deliverability-domain-hint"]');
    await expect(input, 'the deliverability domain input renders').toBeVisible({ timeout: 15000 });

    await input.fill('mail.example.com');
    await expect(hint, 'a valid bare domain shows no hint').toHaveCount(0);
    await input.fill('https://mail.example.com');
    await expect(hint, 'a domain with a protocol is flagged invalid').toBeVisible();
    await input.fill('not a domain');
    await expect(hint, 'a spaced non-domain is flagged invalid').toBeVisible();
    await input.fill('sub.mail.example.co.uk');
    await expect(hint, 'a valid multi-level subdomain clears the hint').toHaveCount(0);

    expect(errors, `no console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('a valid domain check renders the deliverability report (skips if the flag is dark)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/deliverability**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          report: {
            domain: 'mail.example.com',
            spf: { present: true, record: 'v=spf1 include:sendgrid.net ~all' },
            dmarc: { present: true, record: 'v=DMARC1; p=quarantine', policy: 'quarantine' },
            dkim: { present: true, selectorsChecked: ['s1', 's2'], foundSelectors: ['s1'] },
            score: 92,
            recommendations: [],
          },
          needsDomain: false,
        }),
      }),
    );
    await page.goto('/admin/deliverability', { waitUntil: 'domcontentloaded' });

    const input = page.locator('[data-testid="deliverability-domain"]');
    const check = page.locator('[data-testid="deliverability-check-btn"]');
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill('mail.example.com');

    // The Check button disables when the beta flag is dark — skip the result assertion then.
    await expect(check).toBeEnabled({ timeout: 4000 }).catch(() => {});
    test.skip(!(await check.isEnabled()), 'email_deliverability_wizard is dark — Check disabled');

    await check.click();
    await expect(
      page.locator('[data-testid="deliverability-result"]'),
      'a successful check renders the deliverability report',
    ).toBeVisible({ timeout: 12000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a successful check must not crash').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/deliverability-result.png' });
    expect(errors, `no console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
