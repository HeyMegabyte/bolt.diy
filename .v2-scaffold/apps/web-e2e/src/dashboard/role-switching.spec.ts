/**
 * role-switching.spec.ts — TDD RED phase
 *
 * Super-admin signs in, toggles role via the role-switcher component,
 * asserts URL stays at /dashboard, nav items reshape, and the
 * X-View-As header is sent on the next API call.
 */

import { test, expect } from '../_fixtures/auth.js';
import { watchConsoleErrors } from '../_helpers/console-errors.js';

const ROLES = ['Customer', 'Crew', 'Super Admin'] as const;
type Role = (typeof ROLES)[number];

test.describe('role switching', () => {
  test.beforeEach(async ({ authedPage }) => {
    // authedPage fixture has already called signInAsAdmin and landed at "/"
    // Navigate to /dashboard via a click, not a direct goto
    const dashLink = authedPage
      .getByRole('link', { name: /dashboard/i })
      .or(authedPage.getByTestId('nav-dashboard'));
    await expect(dashLink).toBeVisible({ timeout: 8_000 });
    await dashLink.click();
    await expect(authedPage).toHaveURL(/\/dashboard/);
  });

  for (const role of ROLES) {
    test(`switching to "${role}" reshapes nav and sends X-View-As header`, async ({ authedPage }) => {
      const consoleErrors = watchConsoleErrors(authedPage);

      // Intercept next API call to assert header
      let capturedViewAs: string | undefined;
      await authedPage.route('**/api/**', async (route) => {
        capturedViewAs = route.request().headers()['x-view-as'];
        await route.continue();
      });

      // Open the role-switcher
      const roleSwitcher = authedPage
        .getByRole('button', { name: /view as|role/i })
        .or(authedPage.getByTestId('role-switcher'));
      await expect(roleSwitcher).toBeVisible({ timeout: 5_000 });
      await roleSwitcher.click();

      // Select the target role
      const roleOption = authedPage
        .getByRole('option', { name: new RegExp(role, 'i') })
        .or(authedPage.getByTestId(`role-option-${role.toLowerCase().replace(' ', '-')}`));
      await expect(roleOption).toBeVisible();
      await roleOption.click();

      // URL must remain on /dashboard
      await expect(authedPage).toHaveURL(/\/dashboard/);

      // Active role label should reflect the change
      const activeRoleLabel = authedPage
        .getByTestId('active-role-label')
        .or(authedPage.getByRole('status', { name: /viewing as/i }));
      await expect(activeRoleLabel).toContainText(role, { ignoreCase: true });

      // Nav items should reshape — assert at least one role-specific item
      if (role === 'Customer') {
        await expect(
          authedPage.getByTestId('nav-bookings').or(authedPage.getByRole('link', { name: /bookings/i })),
        ).toBeVisible({ timeout: 5_000 });
      } else if (role === 'Crew') {
        await expect(
          authedPage.getByTestId('nav-jobs').or(authedPage.getByRole('link', { name: /jobs/i })),
        ).toBeVisible({ timeout: 5_000 });
      } else if (role === 'Super Admin') {
        await expect(
          authedPage.getByTestId('nav-admin').or(authedPage.getByRole('link', { name: /admin/i })),
        ).toBeVisible({ timeout: 5_000 });
      }

      // Trigger a known API call to verify the header
      await authedPage.evaluate(() => fetch('/api/health'));
      await authedPage.waitForTimeout(300);
      expect(capturedViewAs).toBeDefined();

      consoleErrors.assertNone();
    });
  }
});
