/**
 * P0-ADMIN — REAL-BROWSER (Browserbase) VISUAL SWEEP as brian@megabyte.space.
 *
 * The mandate's literal core (Brian 2026-08-02): every admin feature must be
 * "POPULATED with real data in the brian@megabyte.space account, verified via
 * REAL BROWSER both TECHNICALLY and VISUALLY." The sibling
 * {@link ./admin-section-sweep.spec.ts} sweeps as the e2e-org (E2E_API_KEY),
 * whose build-derived surfaces are legitimately row-empty
 * [[e2e-key-is-not-brians-account]] — so it proves render + data-domain but NOT
 * Brian's actual populated rows. THIS spec closes that gap.
 *
 * Why a browser, not curl: `POST /api/auth/test-login` from curl gets Cloudflare's
 * "Just a moment…" Bot-Fight JS-challenge [[bot-fight-mode-blocks-inbound-webhooks]].
 * A real browser solves the challenge automatically, so the login fetch is issued
 * FROM the page (`page.evaluate`) after a first `goto` establishes the origin.
 *
 * Per section (same contract as the e2e-org sweep): stays in /admin, `<main>`
 * renders substantial content, matches its per-section REAL-DATA signal, no broken
 * copy, 0 NEW console errors, 0 CRITICAL axe, + a full-page screenshot →
 * e2e/screenshots/browserbase/brian-section-<s>.png (Brian's real-data record).
 *
 * ONE billed session, sequential sections. On-demand only:
 *   export RUN_BROWSERBASE=1 E2E_TEST_PASSWORD=… BROWSERBASE_API_KEY=… BROWSERBASE_PROJECT_ID=…
 *   npx playwright test --config playwright.prod.config.ts browserbase/admin-section-sweep-brian --workers=1
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
import { loginAsBrian } from './_brian-login.js';

const PROD = 'https://projectsites.dev';
const GATE = Boolean(
  process.env.RUN_BROWSERBASE && process.env.E2E_TEST_PASSWORD && browserbaseAvailable(),
);

test.describe('Browserbase real-Chrome — admin sweep AS brian@megabyte.space (P0-ADMIN)', () => {
  test.describe.configure({ retries: 0 });

  test('every section renders brian’s real data + 0 console errors + 0 critical axe (real Chrome)', async () => {
    test.skip(!GATE, 'on-demand — RUN_BROWSERBASE=1 + creds + E2E_TEST_PASSWORD');
    test.setTimeout(480_000); // 8 min — login + 20 sections × (nav + render + screenshot + axe)

    const session = await createBrowserbaseSession({ timeoutSec: 600 });
    const browser: Browser = await chromium.connectOverCDP(browserbaseConnectUrl(session.id));
    const failures: string[] = [];
    try {
      const ctx: BrowserContext = browser.contexts()[0] ?? (await browser.newContext());
      const page: Page = ctx.pages()[0] ?? (await ctx.newPage());
      const consoleErrors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|net::ERR/i.test(m.text())) {
          consoleErrors.push(m.text());
        }
      });
      page.on('pageerror', (e) => consoleErrors.push(String(e)));

      // Real login AS brian FROM the page (the shared helper solves the Bot-Fight
      // challenge via a first goto, then seeds ps_session — see ./_brian-login.ts).
      const token = await loginAsBrian(page, PROD, process.env.E2E_TEST_PASSWORD!);
      expect(token.length, 'brian test-login failed (empty token)').toBeGreaterThan(0);

      // Sweep every section as brian — same contract as the e2e-org sweep,
      // NEVER cascade (a bad section must not blind us to the other 19).
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

          const mainText = await page.locator('main').first().innerText().catch(() => '');
          if (mainText.length <= 150) failures.push(`${label}: thin content (${mainText.length} chars)`);
          const lower = mainText.toLowerCase();
          for (const phrase of BROKEN) if (lower.includes(phrase)) failures.push(`${label}: broken copy "${phrase}"`);

          if (!section.signal.test(mainText)) {
            failures.push(`${label}: no real-data signal (expected ${section.signal}) in ${mainText.length} chars`);
          }

          await page.screenshot({
            path: `e2e/screenshots/browserbase/brian-section-${label}.png`,
            fullPage: true,
          });

          const newErrors = consoleErrors.slice(errBefore);
          if (newErrors.length) failures.push(`${label}: console errors — ${newErrors.join(' | ')}`);

          try {
            await checkA11y(page, `/admin/${label} (brian)`);
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

    expect(failures, `brian admin sweep found issues:\n  - ${failures.join('\n  - ')}`).toEqual([]);
  });
});
