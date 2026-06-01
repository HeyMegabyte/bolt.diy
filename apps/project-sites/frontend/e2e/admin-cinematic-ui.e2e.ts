/**
 * @module e2e/admin-cinematic-ui
 *
 * Drift guard for the [[cinematic-ui-patterns]] mandate ("every numeric stat
 * renders through <app-rolling-counter>") on the admin sections converted in
 * rounds 125/126/134. Regression target: someone reverts a stat to a raw
 * `{{ value }}` interpolation → the <app-rolling-counter> element disappears.
 *
 * (appReveal is intentionally NOT asserted here: it's safe-by-default, so an
 * inert directive — the round-124 missing-import bug — and an active one both
 * leave content visible, which an E2E can't distinguish. Rolling counters ARE
 * distinguishable: the custom element is present only when the stat is wired.)
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

// section → a container scope + the min number of rolling counters expected.
const COUNTER_SECTIONS: { path: string; scope: string; min: number; label: string }[] = [
  { path: '/admin/api-tokens', scope: '.at-stat-value', min: 2, label: 'api-tokens stat chips (#125)' },
  { path: '/admin/seo', scope: '.seo-score', min: 1, label: 'seo health score (#126)' },
  { path: '/admin/traces', scope: '.card', min: 1, label: 'ai-logs/traces KPI tiles (#134)' },
  { path: '/admin/audit', scope: '.card', min: 1, label: 'audit KPI tiles (#134)' },
];

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin — cinematic-ui rolling-counter drift guard', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  for (const s of COUNTER_SECTIONS) {
    test(`stats render via app-rolling-counter — ${s.label}`, async ({ page }) => {
      test.setTimeout(60000);
      await seed(page);
      await page.goto(s.path, { waitUntil: 'load' });
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
      const counters = page.locator(`${s.scope} app-rolling-counter`);
      await expect(counters.first()).toBeVisible({ timeout: 15000 });
      expect(await counters.count(), `${s.path} expected ≥${s.min} rolling counters in ${s.scope}`).toBeGreaterThanOrEqual(s.min);
      // The counter must render a numeric value (not be an empty shell).
      await expect(counters.first()).toHaveText(/[0-9]/, { timeout: 5000 });
    });
  }
});
