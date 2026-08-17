/**
 * CHAOS 7 — "The Data-Hungry Owner": Analytics tab switching + deep-linking.
 *
 * chaos-4 only asserts /admin/analytics "renders alive" — it never switches the
 * 8 sub-tabs (Overview/Live Events/Activation Funnel/By Section/Forms/Visitor
 * Funnel/Site Health/Social). A real owner clicks through all of them and
 * bookmarks/refreshes a specific one (?tab=). This journey exercises both:
 * every tab click loads a live panel with zero console/5xx, and every tab is
 * deep-linkable + survives a reload with the correct tab marked aria-selected.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test \
 *   --config=playwright.prod.config.ts chaos-7-analytics-tabs
 */
import { test, expect } from '@playwright/test';
import { trackErrors, seedAuth, assertAlive } from './chaos-helpers';

const TAB_IDS = ['overview', 'live', 'funnel', 'sections', 'forms', 'visitor', 'health', 'social'];

test.describe('CHAOS 7 — Analytics tabs (switch + deep-link)', () => {
  test('clicking every analytics tab loads a live panel — no console error / 5xx / blank', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, process.env.E2E_API_KEY ?? '');
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('analytics-dashboard')).toBeVisible();

    for (const id of TAB_IDS) {
      const tab = page.getByTestId(`analytics-tab-${id}`);
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => page.url()).toContain(`tab=${id}`);
      await assertAlive(page); // panel painted real content, never a blank switch
    }

    expect(e.consoleErrors, e.consoleErrors.join('\n')).toEqual([]);
    expect(e.pageErrors, e.pageErrors.join('\n')).toEqual([]);
    expect(e.serverErrors, e.serverErrors.join('\n')).toEqual([]);
  });

  test('every analytics tab is deep-linkable (?tab=) + survives a hard reload', async ({ page }) => {
    const e = trackErrors(page);
    await seedAuth(page, process.env.E2E_API_KEY ?? '');
    for (const id of TAB_IDS) {
      await page.goto(`/admin/analytics?tab=${id}`, { waitUntil: 'domcontentloaded' });
      // The deep-linked tab must be the selected one (bookmark/refresh restores it).
      await expect(page.getByTestId(`analytics-tab-${id}`)).toHaveAttribute('aria-selected', 'true');
      await assertAlive(page);
    }
    expect(e.consoleErrors, e.consoleErrors.join('\n')).toEqual([]);
    expect(e.serverErrors, e.serverErrors.join('\n')).toEqual([]);
  });
});
