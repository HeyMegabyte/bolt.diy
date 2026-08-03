/**
 * P0-ADMIN — REAL-BROWSER (Browserbase) VISUAL SWEEP of the site-detail SUB-ROUTES
 * as brian@megabyte.space. Closes the last visual-coverage gap after the two
 * top-level sweeps ({@link ./admin-section-sweep.spec.ts} +
 * {@link ./admin-section-sweep-brian.spec.ts}): the `/admin/sites/:id/*` family
 * needs a real per-site context the top-level sweep can't reach.
 *
 * Logs in as brian (shared {@link ./_brian-login.ts}), discovers his first real
 * site via an in-browser `GET /api/sites`, then sweeps its 8 sub-surfaces:
 *   - `/admin/sites/:id`                    (the 4-tab detail: default = Logs)
 *   - `/admin/sites/:id?tab=snapshots|sql|integrations`
 *   - `/admin/sites/:id/branches`
 *   - `/admin/sites/:id/mcp-server`
 *   - `/admin/sites/:id/copilot`            (flag multimodal_copilot — gate-notice OK)
 *   - `/admin/sites/:id/dna`                (flag site_dna_taste_graph — gate-notice OK)
 *
 * Per sub-route: stays in /admin/sites, `<main>` renders substantial content,
 * matches a per-route signal (real data OR — for the flag-gated pair — a calm
 * gate notice, which is the CORRECT state, not an error), no broken copy, 0 NEW
 * console errors, 0 CRITICAL axe, + a screenshot → brian-sitedetail-<label>.png.
 *
 * ONE billed session. On-demand only:
 *   export RUN_BROWSERBASE=1 E2E_TEST_PASSWORD=… BROWSERBASE_API_KEY=… BROWSERBASE_PROJECT_ID=…
 *   npx playwright test --config playwright.prod.config.ts browserbase/admin-site-detail-sweep-brian --workers=1
 */
import { test, expect, chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
  browserbaseAvailable,
  createBrowserbaseSession,
  browserbaseConnectUrl,
} from '../helpers/browserbase.js';
import { checkA11y } from '../helpers/a11y.js';
import { loginAsBrian, listBrianSites } from './_brian-login.js';

const PROD = 'https://projectsites.dev';
const GATE = Boolean(
  process.env.RUN_BROWSERBASE && process.env.E2E_TEST_PASSWORD && browserbaseAvailable(),
);

/** The 8 site-detail sub-surfaces. `suffix` is appended to /admin/sites/:id. */
const SUBROUTES: ReadonlyArray<{ suffix: string; label: string; signal: RegExp }> = [
  { suffix: '', label: 'detail-logs', signal: /log|snapshot|sql|integration|projectsites\.dev/i },
  { suffix: '?tab=snapshots', label: 'detail-snapshots', signal: /snapshot|version|restore|initial|no snapshot/i },
  { suffix: '?tab=sql', label: 'detail-sql', signal: /sql|query|table|console|run|select/i },
  { suffix: '?tab=integrations', label: 'detail-integrations', signal: /integration|connect|mcp|provider|webhook|key/i },
  { suffix: '/branches', label: 'branches', signal: /branch|preview|main|create|deploy|snapshot/i },
  { suffix: '/mcp-server', label: 'mcp-server', signal: /mcp|tool|token|server|endpoint|playground|connect/i },
  // Flag-gated — a calm gate/enable notice is the CORRECT render when off.
  { suffix: '/copilot', label: 'copilot', signal: /copilot|intent|session|enable|available|gate|not available/i },
  { suffix: '/dna', label: 'dna', signal: /dna|taste|preference|feedback|component|available|gate|not available/i },
] as const;

/** Copy that indicates a genuinely broken surface (not an honest empty/gate state). */
const BROKEN = ['something went wrong', 'internal server error', 'application error', 'failed to load the admin'];

test.describe('Browserbase real-Chrome — site-detail sub-routes AS brian (P0-ADMIN)', () => {
  test.describe.configure({ retries: 0 });

  test('every site-detail sub-route renders brian’s real data + 0 console errors + 0 critical axe', async () => {
    test.skip(!GATE, 'on-demand — RUN_BROWSERBASE=1 + creds + E2E_TEST_PASSWORD');
    test.setTimeout(360_000); // 6 min — login + site discovery + 8 sub-routes

    const session = await createBrowserbaseSession({ timeoutSec: 480 });
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

      const token = await loginAsBrian(page, PROD, process.env.E2E_TEST_PASSWORD!);
      expect(token.length, 'brian test-login failed (empty token)').toBeGreaterThan(0);

      const sites = await listBrianSites(page);
      // Prefer a published site (richest data); fall back to any.
      const site = sites.find((s) => s.status === 'published') ?? sites[0];
      expect(site?.id, `brian has no sites to sweep (got ${sites.length})`).toBeTruthy();
      const base = `/admin/sites/${site!.id}`;

      for (const r of SUBROUTES) {
        const errBefore = consoleErrors.length;
        try {
          await page.goto(`${PROD}${base}${r.suffix}`, { waitUntil: 'domcontentloaded' });
          await page
            .waitForFunction(() => (document.querySelector('main')?.innerText?.length ?? 0) > 120, {
              timeout: 25_000,
            })
            .catch(() => {});

          if (!page.url().includes('/admin/sites')) failures.push(`${r.label}: bounced off /admin/sites → ${page.url()}`);

          const mainText = await page.locator('main').first().innerText().catch(() => '');
          if (mainText.length <= 120) failures.push(`${r.label}: thin content (${mainText.length} chars)`);
          const lower = mainText.toLowerCase();
          for (const phrase of BROKEN) if (lower.includes(phrase)) failures.push(`${r.label}: broken copy "${phrase}"`);
          if (!r.signal.test(mainText)) {
            failures.push(`${r.label}: no real-data signal (expected ${r.signal}) in ${mainText.length} chars`);
          }

          await page.screenshot({
            path: `e2e/screenshots/browserbase/brian-sitedetail-${r.label}.png`,
            fullPage: true,
          });

          const newErrors = consoleErrors.slice(errBefore);
          if (newErrors.length) failures.push(`${r.label}: console errors — ${newErrors.join(' | ')}`);

          try {
            await checkA11y(page, `${base}${r.suffix} (brian)`);
          } catch (e) {
            failures.push(`${r.label}: axe-critical — ${(e as Error).message.slice(0, 400)}`);
          }
        } catch (e) {
          failures.push(`${r.label}: navigation/render threw — ${(e as Error).message.slice(0, 200)}`);
        }
      }
    } finally {
      await browser.close();
    }

    expect(failures, `site-detail sub-route sweep found issues:\n  - ${failures.join('\n  - ')}`).toEqual([]);
  });
});
