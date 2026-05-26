import { test as base, Page } from '@playwright/test';

/**
 * Stubbed admin user — every E2E spec uses `brian@megabyte.space` as the
 * canonical admin account. Defined in one place so a single rename is the
 * only edit needed if Brian ever wants a different test email.
 *
 * Matches `MOCK_USER` in `scripts/e2e_server.cjs` so the localStorage stub
 * and the /api/auth/me handler stay in lock-step.
 */
export const STUB_USER = {
  id: 'user-brian',
  email: 'brian@megabyte.space',
  name: 'Brian Zalewski',
  org_id: 'org-megabyte-labs',
  is_admin: true,
  is_super_admin: true,
  role: 'admin' as const,
} as const;

/**
 * Custom fixtures:
 * - `authedPage` — page signed in as `brian@megabyte.space` (admin)
 * - `anonPage`   — page with localStorage cleared (signed-out baseline)
 *
 * Both bootstrap on `/` and clear `ps_feedback_dismissed` + any stale
 * session before applying the desired state, so specs start from a
 * deterministic baseline regardless of prior runs.
 */
export const test = base.extend<{ authedPage: Page; anonPage: Page }>({
  authedPage: async ({ page }, use) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate((user) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: 'mock-token-brian', identifier: user.email }),
      );
      localStorage.setItem('ps_user', JSON.stringify(user));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    }, STUB_USER);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await use(page);
  },
  anonPage: async ({ page }, use) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await use(page);
  },
});

export { expect } from '@playwright/test';
