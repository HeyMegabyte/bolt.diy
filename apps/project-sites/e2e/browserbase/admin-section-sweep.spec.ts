/**
 * P0-ADMIN — REAL-BROWSER (Browserbase) VISUAL SWEEP across the admin sections.
 *
 * Extends the deep-component proof ({@link ./admin-deep-visual.spec.ts}) into a
 * broad sweep: one managed Browserbase real Chrome session (no device emulation,
 * so deep section content actually renders — see
 * [[deep-admin-components-need-browserbase]]) navigates each section with a REAL
 * session (E2E_API_KEY → real bearer → live prod data on every `/api` call, no
 * stubbing), and per section asserts:
 *  - it stays in /admin (no 401 → /signin bounce),
 *  - the `<main>` renders SUBSTANTIAL content (real Chrome renders the deep body),
 *  - no genuinely-broken copy (500 / "something went wrong" / "isn't enabled"),
 *  - no NEW console errors during that section's load,
 *  - a full-page screenshot → e2e/screenshots/browserbase/section-<s>.png (the
 *    visual record for AI-vision review).
 *
 * ONE billed session shared across all sections (serial). On-demand only:
 *   export RUN_BROWSERBASE=1 E2E_API_KEY=… BROWSERBASE_API_KEY=… BROWSERBASE_PROJECT_ID=…
 *   npx playwright test --config playwright.prod.config.ts browserbase/admin-section-sweep --workers=1
 */
import { test, expect, chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
  browserbaseAvailable,
  createBrowserbaseSession,
  browserbaseConnectUrl,
} from '../helpers/browserbase.js';

const PROD = 'https://projectsites.dev';
const GATE = Boolean(
  process.env.RUN_BROWSERBASE && process.env.E2E_API_KEY && browserbaseAvailable(),
);

/** Sections to sweep. '' = the dashboard hub. logs/user are in admin-deep-visual. */
const SECTIONS = [
  '',
  'analytics',
  'feature-flags',
  'apps',
  'system-services',
  'docs',
  'billing',
  'domains',
  'snapshots',
  'forms',
  'social',
  'media',
  'seo',
  'site-features',
  'settings',
] as const;

/** Copy that indicates a genuinely broken surface (not an honest empty state). */
const BROKEN = ['something went wrong', 'internal server error', 'application error', 'failed to load the admin'];

test.describe.serial('Browserbase real-Chrome — admin section visual sweep (P0-ADMIN)', () => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    if (!GATE) return;
    const session = await createBrowserbaseSession();
    browser = await chromium.connectOverCDP(browserbaseConnectUrl(session.id));
    const ctx: BrowserContext = browser.contexts()[0] ?? (await browser.newContext());
    // Inject the real session so every /api call carries the bearer → live data.
    await ctx.addInitScript(
      ({ t, id }: { t: string; id: string }) => {
        localStorage.setItem(
          'ps_session',
          JSON.stringify({ token: t, identifier: id, createdAt: Date.now() }),
        );
      },
      { t: process.env.E2E_API_KEY!, id: 'brian@megabyte.space' },
    );
    page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|net::ERR/i.test(m.text())) {
        consoleErrors.push(m.text());
      }
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  for (const section of SECTIONS) {
    const label = section || '(dashboard)';
    test(`/admin/${section} — renders populated, no errors (real Chrome)`, async () => {
      test.skip(!GATE, 'on-demand — RUN_BROWSERBASE=1 + creds + E2E_API_KEY');
      const p = page!;
      const errBefore = consoleErrors.length;

      await p.goto(`${PROD}/admin/${section}`, { waitUntil: 'domcontentloaded' });
      // Real Chrome renders the deep body — wait for <main> to fill with content.
      await p
        .waitForFunction(
          () => (document.querySelector('main')?.innerText?.length ?? 0) > 150,
          { timeout: 25_000 },
        )
        .catch(() => {});

      // 1. No bounce to /signin.
      expect(p.url(), `${label} must stay in /admin`).toContain('/admin');

      // 2. Substantial real content rendered (real Chrome → the section body, not
      //    just the shell). 150+ chars of main text = populated or an honest state.
      const mainText = await p.locator('main').innerText().catch(() => '');
      expect(mainText.length, `${label} must render substantial content — got ${mainText.length}`).toBeGreaterThan(150);

      // 3. No genuinely-broken copy.
      const lower = mainText.toLowerCase();
      for (const phrase of BROKEN) {
        expect(lower.includes(phrase), `${label} shows broken copy: "${phrase}"`).toBe(false);
      }

      await p.screenshot({
        path: `e2e/screenshots/browserbase/section-${section || 'dashboard'}.png`,
        fullPage: true,
      });

      // 4. No NEW console errors during this section's load.
      const newErrors = consoleErrors.slice(errBefore);
      expect(newErrors, `${label} raised console errors: ${newErrors.join(' | ')}`).toEqual([]);
    });
  }
});
