/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: `/admin/team` renders honest
 * empty states for BOTH the members list and the pending-invitations list when the organization
 * has neither — not a crash, not a blank. Two independent empty affordances.
 *
 * Injection: stub the Better-Auth `get-full-organization` call with a real org shape carrying
 * empty `members` + `invitations` arrays (the component's `applyOrg(res.data)` reads
 * `org.members` / `org.invitations`). `team.component.ts`: `@else` when `members().length === 0`
 * → `data-testid="team-members-empty"` ("No members yet.") and when `invitations().length === 0`
 * → `data-testid="team-invitations-empty"` ("No pending invitations."). Org-scoped.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./team-interactions.spec.ts}
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

test.describe('Admin · Team empty-state honesty (P0-ADMIN)', () => {
  test('an org with no members/invites renders BOTH honest empty states (no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    // The Better-Auth org client wraps the HTTP body into `res.data`; return a real org with
    // empty members + invitations so both @else branches render.
    await page.route('**/get-full-organization**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"id":"org-e2e","name":"E2E Org","slug":"e2e-org","members":[],"invitations":[]}',
      }),
    );
    await page.goto('/admin/team', { waitUntil: 'domcontentloaded' });

    await expect(
      page.locator('[data-testid="team-members-empty"]'),
      'the members empty state renders',
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator('[data-testid="team-invitations-empty"]'),
      'the invitations empty state renders',
    ).toBeVisible();
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty org must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/team-empty-state.png' });
    expect(errors, `no console errors on honest empty states — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
