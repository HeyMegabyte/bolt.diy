/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — SECTION ALIAS REDIRECTS + the real
 * MEDIA surface (the editor's Media tab).
 *
 * The dashboard section-guide + not-found route hints advertise `/admin/media`,
 * `/admin/traces`, `/admin/seo` — but those surfaces live elsewhere, so
 * `app.routes.ts` registers deliberate alias redirects (a deprecated-route shim,
 * NOT dead code — see [[alias-modules-intentional]]) so every advertised link +
 * bookmark resolves instead of rendering the admin not-found page:
 *   - /admin/media  → /admin/editor          (Media is the editor's Media tab)
 *   - /admin/traces → /admin/logs?tab=traces  (AI Traces tab under Logs)
 *   - /admin/seo    → /admin/site-features     (search-readiness toggles)
 *
 * Test 1 proves each redirect resolves (client-side Angular routing → instant +
 * load-independent → robust; see [[admin-verify-e2e-authoring-gotchas]]).
 *
 * Test 2 proves the REAL media studio is reachable the way it's actually wired:
 * on /admin/editor, the editor-tabs strip exposes Code / Media / Agents; selecting
 * Media activates it (`aria-selected` + persisted `localStorage['editor.tab']`).
 * `AdminMediaComponent` (the med-panel-* studio) mounts inside AdminComponent and
 * renders when that tab is active — so a med-panel appearing proves the media
 * library is live, not orphaned behind the redirect.
 *
 * Real session (E2E_API_KEY) so /admin/* mounts authed.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./admin-tabs.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Advertised deprecated path → the canonical surface it must resolve to. */
const ALIASES = [
  { from: '/admin/media', expect: (u: URL) => u.pathname === '/admin/editor', label: 'media → editor' },
  {
    from: '/admin/traces',
    expect: (u: URL) => u.pathname === '/admin/logs' && u.searchParams.get('tab') === 'traces',
    label: 'traces → logs?tab=traces',
  },
  { from: '/admin/seo', expect: (u: URL) => u.pathname === '/admin/site-features', label: 'seo → site-features' },
] as const;

test.describe('Admin · section alias redirects + editor Media surface (P0-ADMIN)', () => {
  test('every advertised alias route resolves to its real surface (never the not-found page)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });

    for (const alias of ALIASES) {
      await page.goto(alias.from, { waitUntil: 'domcontentloaded' });
      // The redirect is a client-side Angular route resolver — wait for the URL to
      // settle onto the canonical surface.
      await page
        .waitForFunction(
          (target) => {
            const u = new URL(location.href);
            if (target === 'media') return u.pathname === '/admin/editor';
            if (target === 'traces') return u.pathname === '/admin/logs' && u.searchParams.get('tab') === 'traces';
            return u.pathname === '/admin/site-features';
          },
          alias.label.split(' ')[0],
          { timeout: 10000 },
        )
        .catch(() => {});

      const finalUrl = new URL(page.url());
      expect(alias.expect(finalUrl), `${alias.label}: landed on ${finalUrl.pathname}${finalUrl.search}`).toBe(true);

      // And it must NOT be the admin not-found page (the bug these aliases prevent).
      const body = (await page.locator('body').innerText()).toLowerCase();
      expect(
        body.includes("admin page doesn't exist") || body.includes('page does not exist'),
        `${alias.label} must not render the admin not-found page`,
      ).toBe(false);
    }
  });

  test('editor Media tab activates the media studio (real, not orphaned)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/editor', { waitUntil: 'domcontentloaded' });

    // The editor-tabs strip (Code / Media / Agents) is the real entry to media.
    const mediaTab = page.locator('[data-testid="editor-tab-media"]');
    await mediaTab.waitFor({ state: 'visible', timeout: 15000 });

    await mediaTab.click();

    // Tab is now the selected one (client-side signal → aria-selected).
    await expect(mediaTab, 'the Media editor tab must become selected on click').toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 6000 },
    );

    // Selection persists across reload (documented contract: localStorage['editor.tab']).
    const persisted = await page.evaluate(() => localStorage.getItem('editor.tab'));
    expect(persisted, "the active editor tab must persist to localStorage['editor.tab']").toBe('media');

    // The media studio itself renders (AdminMediaComponent) — a med-panel proves the
    // library is live, not dead code behind the /admin/media redirect.
    await expect(
      page.locator('[id^="med-panel-"]').first(),
      'selecting Media must render the media studio (a med-panel-* section)',
    ).toBeVisible({ timeout: 15000 });
  });
});
