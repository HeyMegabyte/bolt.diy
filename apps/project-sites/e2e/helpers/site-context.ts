/**
 * @module e2e/helpers/site-context
 *
 * Site-context seeding for admin-verify specs. Many admin surfaces are SITE-SCOPED
 * in one of two ways, and the E2E_API_KEY (e2e-test-org) session starts with NO
 * globally-selected site (`AdminStateService.selectedSiteId` = null, no localStorage
 * persistence) — so those surfaces silently `test.skip` without seeding first
 * (see [[admin-verify-e2e-authoring-gotchas]] #8, the selectedSite sub-case).
 *
 * Two seeding paths:
 *  - {@link resolveFirstSiteId} — for ROUTE-param surfaces (`/admin/sites/:id/*`):
 *    fetch the org's first site id and put it in the URL (no global selection needed).
 *  - {@link selectFirstSite} — for `selectedSite()`-gated surfaces (Settings Business
 *    tab, etc.): drive the sidebar site-switcher so `selectSite()` runs. Call it AFTER
 *    landing on an `/admin/*` page (the switcher is in the shell on every admin route);
 *    never `page.goto()` afterwards (a full reload re-inits the service → resets it).
 */
import type { Page } from '@playwright/test';

/** Resolve the org's first site id via the API (for `/admin/sites/:id/*` route params). */
export async function resolveFirstSiteId(page: Page, token: string): Promise<string | null> {
  return page.evaluate(async (bearer) => {
    const res = await fetch('/api/sites', { headers: { Authorization: `Bearer ${bearer}` } });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const list = (j.data || j.sites || j.items || []) as Array<{ id?: string }>;
    return list[0]?.id ?? null;
  }, token);
}

/**
 * Drive the sidebar site-switcher to select the org's first site, so
 * `selectedSite()` becomes non-null and `selectedSite()`-gated panels render.
 * Must run on an already-loaded `/admin/*` page. Returns false if the switcher or
 * any site option isn't reachable (caller should `test.skip`).
 */
export async function selectFirstSite(page: Page): Promise<boolean> {
  const trigger = page.locator('button[aria-label="Select site"]').first();
  await trigger.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if ((await trigger.count()) === 0) return false;
  await trigger.click();
  const option = page.locator('button[role="option"]').first();
  await option.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  if ((await option.count()) === 0) return false;
  await option.click();
  await page.waitForTimeout(600); // let selectedSite() + its downstream loads settle
  return true;
}
