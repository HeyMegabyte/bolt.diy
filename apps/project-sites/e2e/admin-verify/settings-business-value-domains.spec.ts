/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — VALUE-DOMAIN coverage (directive #3) for
 * the Settings BUSINESS tab (`/admin/settings` → "Business"). settings-value-domains
 * covers the General tab; this fills the Business-tab gap.
 *
 * The Business tab content is `@if (state.selectedSite())`-gated (settings.component:
 * 437) — the E2E session starts with no selected site — so it seeds one via
 * `selectFirstSite` (the sidebar switcher) BEFORE clicking the tab.
 *
 * NON-MUTATING by construction: `saveBusiness()` runs `if (!validateBusiness()) return`
 * BEFORE any network write (1170-1188). Clicking Save with a GUARANTEED-INVALID field
 * surfaces the inline error (aria-invalid) and short-circuits — no PATCH is sent. Each
 * test also asserts zero PATCH/PUT fired.
 *
 * @see {@link ../helpers/site-context.ts}
 * @see {@link ./settings-value-domains.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { selectFirstSite } from '../helpers/site-context.js';

const reachBusinessTab = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
  // Seed a globally-selected site so the `@if (selectedSite())`-gated Business form renders.
  if (!(await selectFirstSite(page))) return false;
  const tab = page.getByRole('tab', { name: /business/i }).first();
  if ((await tab.count()) === 0) return false;
  await tab.click();
  const name = page.locator('[data-testid="business-name"]');
  await name.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
  return name.isVisible().catch(() => false);
};

/** Capture any mutating request while running `body` — must stay empty (invalid → no save). */
const withMutationWatch = async (page: import('@playwright/test').Page, body: () => Promise<void>) => {
  const mutations: string[] = [];
  const onReq = (req: import('@playwright/test').Request) => {
    const m = req.method();
    if ((m === 'PATCH' || m === 'PUT') && req.url().includes('/api/')) {
      mutations.push(`${m} ${req.url().replace('https://projectsites.dev', '').slice(0, 60)}`);
    }
  };
  page.on('request', onReq);
  await body();
  await page.waitForTimeout(800);
  page.off('request', onReq);
  return mutations;
};

test.describe('Admin · Settings Business tab — value domain (P0-ADMIN)', () => {
  test('an empty business name is rejected on save (aria-invalid) and writes nothing', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await reachBusinessTab(page)), 'Business tab not reachable (no site to select)');
    const name = page.locator('[data-testid="business-name"]');

    const mutations = await withMutationWatch(page, async () => {
      await name.fill(''); // clears (marks dirty → save enabled); required → invalid
      await page.locator('[data-testid="business-save"]').click();
    });
    await expect(name, 'an empty required name flips aria-invalid').toHaveAttribute('aria-invalid', 'true', {
      timeout: 4000,
    });
    expect(mutations, `invalid save must not write — saw ${mutations.join(' | ')}`).toEqual([]);
  });

  test('an unparseable website URL is rejected on save (aria-invalid) and writes nothing', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await reachBusinessTab(page)), 'Business tab not reachable (no site to select)');
    const name = page.locator('[data-testid="business-name"]');
    const website = page.locator('[data-testid="business-website"]');

    const mutations = await withMutationWatch(page, async () => {
      await name.fill('CI Probe Co'); // keep name valid → isolate the website error
      await website.fill('notaurl'); // new URL('notaurl') throws → invalid
      await page.locator('[data-testid="business-save"]').click();
    });
    await expect(website, 'an unparseable URL flips aria-invalid').toHaveAttribute('aria-invalid', 'true', {
      timeout: 4000,
    });
    expect(mutations, `invalid save must not write — saw ${mutations.join(' | ')}`).toEqual([]);
  });
});
