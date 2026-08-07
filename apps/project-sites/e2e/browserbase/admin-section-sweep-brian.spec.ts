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
import { SECTIONS, BRIAN_ONLY_SECTIONS, BROKEN } from './_admin-sections.js';
import { loginAsBrian } from './_brian-login.js';

/** brian sees the shared 22 PLUS the operator-only sections (super-admin). */
const BRIAN_SECTIONS = [...SECTIONS, ...BRIAN_ONLY_SECTIONS];

const PROD = 'https://projectsites.dev';
const GATE = Boolean(
  process.env.RUN_BROWSERBASE && process.env.E2E_TEST_PASSWORD && browserbaseAvailable(),
);

test.describe('Browserbase real-Chrome — admin sweep AS brian@megabyte.space (P0-ADMIN)', () => {
  // retries:1 — a Browserbase session can transiently DROP mid-sweep ("Target page
  // has been closed"); that's non-deterministic infra, exactly what a retry heals
  // (a fresh session + re-login on attempt 2). Each attempt is a clean full run.
  test.describe.configure({ retries: 1 });

  test('every section renders brian’s real data + 0 console errors + 0 critical axe (real Chrome)', async () => {
    test.skip(!GATE, 'on-demand — RUN_BROWSERBASE=1 + creds + E2E_TEST_PASSWORD');
    // 15 min — 23 sections × (nav + up-to-25s render wait + screenshot + axe) plus
    // login empirically runs ~10 min and SIGTERM'd at the old 600s ceiling mid-final-
    // section (2026-08-07). Match the Browserbase session's own 900s lifetime so the
    // test completes + reports its per-section verdict instead of dying at the buzzer.
    test.setTimeout(900_000);

    const session = await createBrowserbaseSession({ timeoutSec: 900 });
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

      // Network-failure log — surfaces failed /api requests (the mandate's "no
      // failed requests"). status-0 requestfailed is what fires ApiService's
      // "Can't reach the server" toast; 4xx/5xx catches broken endpoints. Logged
      // per section (not a hard fail — some failures are benign aborts on nav).
      const netFailures: string[] = [];
      page.on('requestfailed', (req) => {
        const u = req.url();
        if (u.includes('/api/')) netFailures.push(`FAILED ${req.method()} ${u.replace(PROD, '')} — ${req.failure()?.errorText ?? '?'}`);
      });
      page.on('response', (res) => {
        const u = res.url();
        if (u.includes('/api/') && res.status() >= 400) netFailures.push(`HTTP ${res.status()} ${res.request().method()} ${u.replace(PROD, '')}`);
      });

      // Real login AS brian FROM the page (the shared helper solves the Bot-Fight
      // challenge via a first goto, then seeds ps_session — see ./_brian-login.ts).
      const token = await loginAsBrian(page, PROD, process.env.E2E_TEST_PASSWORD!);
      expect(token.length, 'brian test-login failed (empty token)').toBeGreaterThan(0);

      // Sweep every section as brian (22 shared + operator-only) — same contract
      // as the e2e-org sweep, NEVER cascade (a bad section must not blind the rest).
      for (const section of BRIAN_SECTIONS) {
        const label = section.path || 'dashboard';
        const errBefore = consoleErrors.length;
        const netBefore = netFailures.length;
        try {
          await page.goto(`${PROD}/admin/${section.path}`, { waitUntil: 'domcontentloaded' });
          await page
            .waitForFunction(() => (document.querySelector('main')?.innerText?.length ?? 0) > 150, {
              // 10s (was 25s): 23 sections × a 25s worst-case tail blew the 900s test budget →
              // attempt 1 timed out mid-sweep → retries:1 then burned a 2nd Browserbase session
              // (observed 2026-08-07, ~20min run). The >150-char bar is basic-render, hit in <3s
              // normally; 10s caps the slow-section tail so all 23 finish well within 900s. The
              // `.catch` still proceeds if a section is genuinely slower (its screenshot/axe run
              // regardless), so this only bounds waits — it never turns a slow render into a fail.
              timeout: 10_000,
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

          // Diagnostic (not a hard fail): log any /api request that failed during
          // this section's load — pins the source of ApiService's status-0 toast.
          const newNet = netFailures.slice(netBefore);
          if (newNet.length) console.log(`[net ${label}] ${newNet.join(' | ')}`);

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
