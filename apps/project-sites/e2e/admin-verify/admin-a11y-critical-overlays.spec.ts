/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the OVERLAY states (a create modal, the
 * command palette, the mobile nav drawer) have ZERO axe-CRITICAL a11y violations while
 * OPEN. Overlays are the highest a11y-risk surfaces (focus management, `aria-modal`,
 * accessible names, no keyboard trap-out) — the section-level axe specs only scan the
 * base page, never an open overlay.
 *
 * Per directive #2 (a11y advisory EXCEPT critical). NON-MUTATING: opens an overlay +
 * scans + never submits. Openers are all verified in prior fires.
 *
 * @see {@link ./admin-a11y-critical.spec.ts} {@link ./admin-modal-lifecycle.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import AxeBuilder from '@axe-core/playwright';

const criticalOf = async (page: import('@playwright/test').Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return results.violations.filter((v) => v.impact === 'critical');
};
const fmt = (v: { id: string; nodes: unknown[] }[]) => v.map((x) => `${x.id}×${x.nodes.length}`).join(', ') || 'none';

test.describe('Admin · critical a11y — open overlays (P0-ADMIN)', () => {
  test('the API-token create modal (open) has zero CRITICAL axe violations', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/api-tokens', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="at-create-open"]').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('[data-testid="at-create-open"]').click();
    await expect(page.locator('[role="dialog"]'), 'the modal opened').toBeVisible({ timeout: 6000 });
    await page.waitForTimeout(600);
    const critical = await criticalOf(page);
    expect(critical, `open modal CRITICAL a11y: ${fmt(critical)}`).toEqual([]);
  });

  test('the command palette (open) has zero CRITICAL axe violations', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    // Palette keydown listener attaches once the shell mounts (P0.98).
    await page.locator('[data-testid="user-avatar-btn"]').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+k');
    await expect(page.locator('[data-testid="palette-input"]'), 'the palette opened').toBeVisible({ timeout: 6000 });
    await page.waitForTimeout(500);
    const critical = await criticalOf(page);
    expect(critical, `open palette CRITICAL a11y: ${fmt(critical)}`).toEqual([]);
  });

  test('the mobile nav drawer (open, 375px) has zero CRITICAL axe violations', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await page.setViewportSize({ width: 375, height: 812 });
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.locator('[aria-label="Open navigation menu"]').first().waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('[aria-label="Open navigation menu"]').first().click();
    await expect(page.locator('[data-testid="admin-sidebar-mobile-close"]'), 'the drawer opened').toBeVisible({
      timeout: 6000,
    });
    await page.waitForTimeout(500);
    const critical = await criticalOf(page);
    expect(critical, `open drawer CRITICAL a11y: ${fmt(critical)}`).toEqual([]);
  });
});
