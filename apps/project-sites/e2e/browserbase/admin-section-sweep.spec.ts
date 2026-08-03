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
import { checkA11y } from '../helpers/a11y.js';
import { SECTIONS, BROKEN } from './_admin-sections.js';

const PROD = 'https://projectsites.dev';
const GATE = Boolean(
  process.env.RUN_BROWSERBASE && process.env.E2E_API_KEY && browserbaseAvailable(),
);

test.describe('Browserbase real-Chrome — admin section visual sweep (P0-ADMIN)', () => {
  // Deterministic collect-then-assert (below) — retries would just re-bill a
  // Browserbase session for the same result.
  test.describe.configure({ retries: 0 });

  test('every section renders populated + 0 console errors + 0 critical axe (real Chrome)', async () => {
    test.skip(!GATE, 'on-demand — RUN_BROWSERBASE=1 + creds + E2E_API_KEY');
    test.setTimeout(480_000); // 8 min — 20 sections × (nav + render + screenshot + axe)

    const session = await createBrowserbaseSession({ timeoutSec: 600 });
    const browser: Browser = await chromium.connectOverCDP(browserbaseConnectUrl(session.id));
    const failures: string[] = [];
    try {
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
      const page: Page = ctx.pages()[0] ?? (await ctx.newPage());
      const consoleErrors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|net::ERR/i.test(m.text())) {
          consoleErrors.push(m.text());
        }
      });
      page.on('pageerror', (e) => consoleErrors.push(String(e)));

      // One session, sequential sections — collect issues per section, NEVER
      // cascade (a bad section must not blind us to the other 19).
      for (const section of SECTIONS) {
        const label = section.path || 'dashboard';
        const errBefore = consoleErrors.length;
        try {
          await page.goto(`${PROD}/admin/${section.path}`, { waitUntil: 'domcontentloaded' });
          await page
            .waitForFunction(() => (document.querySelector('main')?.innerText?.length ?? 0) > 150, {
              timeout: 25_000,
            })
            .catch(() => {});

          if (!page.url().includes('/admin')) failures.push(`${label}: bounced off /admin → ${page.url()}`);

          // `.first()` — a section that (wrongly) nests its own <main> inside the
          // shell's <main> would otherwise strict-mode-throw here (0 chars).
          const mainText = await page.locator('main').first().innerText().catch(() => '');
          if (mainText.length <= 150) failures.push(`${label}: thin content (${mainText.length} chars)`);
          const lower = mainText.toLowerCase();
          for (const phrase of BROKEN) if (lower.includes(phrase)) failures.push(`${label}: broken copy "${phrase}"`);

          // REAL-DATA proof: the section must render ITS OWN data domain, not a
          // blank/spinner/error shell. Distinguishes "populated" from "merely
          // gated+rendered" — the exact gap Brian flagged 2026-08-02.
          if (!section.signal.test(mainText)) {
            failures.push(`${label}: no real-data signal (expected ${section.signal}) in ${mainText.length} chars`);
          }

          await page.screenshot({
            path: `e2e/screenshots/browserbase/section-${label}.png`,
            fullPage: true,
          });

          const newErrors = consoleErrors.slice(errBefore);
          if (newErrors.length) failures.push(`${label}: console errors — ${newErrors.join(' | ')}`);

          // Critical-only axe (directive #2). Wrapped so a violation/timeout on
          // one section records the finding without aborting the sweep.
          try {
            await checkA11y(page, `/admin/${label}`);
          } catch (e) {
            failures.push(`${label}: axe-critical — ${(e as Error).message.slice(0, 400)}`);
          }
        } catch (e) {
          failures.push(`${label}: navigation/render threw — ${(e as Error).message.slice(0, 200)}`);
        }
      }
    } finally {
      await browser.close();
    }

    expect(failures, `admin section sweep found issues:\n  - ${failures.join('\n  - ')}`).toEqual([]);
  });
});
