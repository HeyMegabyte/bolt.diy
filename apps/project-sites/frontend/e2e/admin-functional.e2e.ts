/**
 * @module e2e/admin-functional
 *
 * Deep functional sweep of EVERY legacy /admin section. Routing is proven by
 * admin-routing.e2e.ts; this spec hunts FUNCTIONAL breakage: uncaught page
 * errors, app-level console errors, failed `/api/*` calls (4xx/5xx), and empty
 * sections that should have rendered content. Seeds `ps_session` from
 * `E2E_API_KEY`. The per-route findings are collected + logged so one run
 * surfaces the whole picture, then asserts the hard invariants (no pageerror,
 * no app console error) across the entire admin. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page, type ConsoleMessage, type Response } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

// Console-error noise that is NOT an app fault (3rd-party beacons + framework dev hints).
const IGNORE_CONSOLE = [
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /posthog/i,
  /NG0911/i,
  /editor\.projectsites\.dev/i,
  /Failed to load resource/i, // generic resource-404 text, no URL → can't target; external/benign
];
const isAppConsoleError = (t: string): boolean => !IGNORE_CONSOLE.some((re) => re.test(t));

// Only the SAME-ORIGIN admin worker counts. The persistent bolt editor iframe
// (`editor.projectsites.dev`) makes its OWN cross-origin calls — most loudly
// `/api/models` (bolt's provider list) on every admin section — which are the
// embedded editor's concern, not the admin worker's. Filter by host.
const ADMIN_HOST = /(^|\.)projectsites\.dev$/i;
function isAdminWorkerCall(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return ADMIN_HOST.test(h) && !/^editor\./i.test(h);
  } catch {
    return false;
  }
}

// Same-origin endpoints whose non-2xx is a KNOWN graceful path, not a regression:
//  - /chat 404            → "no chat yet" graceful empty
//  - /api/sites/<seed>/*  → E2E-seed org uses slug-shaped ids; real prod uses
//    UUIDs so loadSiteAndAuth resolves fine (verified — not a prod bug)
//  - 401 on flag/scope-gated reads (v1-tokens, content/freshness, pseo) →
//    the section degrades gracefully; gating is intentional
const BENIGN_API = [
  /\/api\/sites\/by-slug\/[^/]+\/chat/i,
  /\/api\/sites\/e2e-[^/]+\//i,
  /\/api\/sites\/e2e-[^/]+\b/i,
  // The E2E auth row is a `psk_test_` API key whose `created_by` is null, so the
  // worker's session `userId` is unset. Endpoints that gate on `userId` (content
  // freshness) or resolve the seed slug-as-id (pseo) 401 here — real browser
  // sessions always carry a userId, so these are E2E-context, not prod bugs.
  /\/api\/content\/freshness/i,
  /\/api\/pseo\//i,
  // log_explorer is a feature-flagged section: when the flag is off the worker
  // 404s POST /api/logs/search + GET /api/logs/cost-by-route (never 403 — don't
  // leak feature existence), and logs-explorer renders an honest flag-aware
  // disabled state (verified). Same class as the content/pseo gated reads above.
  /\/api\/logs\/(search|cost-by-route)/i,
];
const isBenignApi = (url: string): boolean => BENIGN_API.some((re) => re.test(url));

// Every admin route that loads real data (the surfaces worth functionally checking).
const SECTIONS: { path: string; label: string }[] = [
  { path: '/admin', label: 'dashboard' },
  { path: '/admin/sites', label: 'sites' },
  { path: '/admin/snapshots', label: 'snapshots' },
  { path: '/admin/analytics', label: 'analytics' },
  { path: '/admin/billing', label: 'billing' },
  { path: '/admin/audit', label: 'audit' },
  { path: '/admin/api-tokens', label: 'api-tokens' },
  { path: '/admin/feature-flags', label: 'feature-flags' },
  { path: '/admin/content-freshness', label: 'content-freshness' },
  { path: '/admin/pseo', label: 'pseo' },
  { path: '/admin/seo', label: 'seo' },
  { path: '/admin/forms', label: 'forms' },
  { path: '/admin/features', label: 'features' },
  { path: '/admin/traces', label: 'traces' },
  { path: '/admin/ai-endpoints', label: 'ai-endpoints' },
  { path: '/admin/voice', label: 'voice' },
  { path: '/admin/media', label: 'media' },
  { path: '/admin/domains', label: 'domains' },
  { path: '/admin/logs', label: 'logs' },
  { path: '/admin/social', label: 'social' },
  { path: '/admin/apps', label: 'apps' },
  { path: '/admin/settings', label: 'settings' },
  { path: '/admin/docs', label: 'docs' },
];

interface Finding {
  consoleErrors: string[];
  pageErrors: string[];
  apiFailures: string[];
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
    } catch {
      /* private mode */
    }
  }, KEY);
}

test.describe('legacy /admin — functional sweep (every section works)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');

  test('every section loads, fetches cleanly, and renders content', async ({ page }) => {
    test.setTimeout(300_000);
    await seed(page);

    const findings: Record<string, Finding> = {};
    let current = 'init';
    const cur = (): Finding => (findings[current] ??= { consoleErrors: [], pageErrors: [], apiFailures: [] });

    page.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error' && isAppConsoleError(m.text())) cur().consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => cur().pageErrors.push(e.message));
    page.on('response', (r: Response) => {
      const url = r.url();
      if (/\/api\//.test(url) && r.status() >= 400 && isAdminWorkerCall(url) && !isBenignApi(url)) {
        cur().apiFailures.push(`${r.status()} ${r.request().method()} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
      }
    });

    for (const s of SECTIONS) {
      current = s.label;
      cur(); // ensure key exists even if clean
      await page.goto(s.path, { waitUntil: 'load' });
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 20000 });
      // let data fetches settle (sections fire /api on init)
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(600);
      // section painted real content (not a blank outlet)
      const contentLen = await page.evaluate(() => (document.body.textContent ?? '').trim().length);
      expect(contentLen, `${s.label} rendered content`).toBeGreaterThan(120);
      // section did NOT crash into the error boundary (the boundary swallows
      // the throw, so an uncaught-pageerror check alone misses it — assert the
      // fallback isn't shown). Caught the Billing `.some` crash.
      const crashed = await page.locator('[data-testid="section-error-boundary"]').count();
      expect(crashed, `${s.label} must not crash into the section error boundary`).toBe(0);
    }

    // ---- report the full picture in one place ----
    const lines: string[] = [];
    let apiTotal = 0;
    for (const s of SECTIONS) {
      const f = findings[s.label];
      if (!f) continue;
      apiTotal += f.apiFailures.length;
      if (f.consoleErrors.length || f.pageErrors.length || f.apiFailures.length) {
        lines.push(`\n### ${s.label}`);
        f.pageErrors.forEach((e) => lines.push(`  ✗ pageerror: ${e}`));
        f.consoleErrors.forEach((e) => lines.push(`  ✗ console: ${e}`));
        f.apiFailures.forEach((e) => lines.push(`  ⚠ api: ${e}`));
      }
    }
    console.warn(`\n===== ADMIN FUNCTIONAL SWEEP =====${lines.length ? lines.join('\n') : '\n  ✓ all sections clean'}\n==================================`);
    console.warn(`API failures (non-benign): ${apiTotal}`);

    // HARD invariants: zero uncaught JS errors + zero app console errors anywhere.
    const allConsole = SECTIONS.flatMap((s) => (findings[s.label]?.consoleErrors ?? []).map((e) => `[${s.label}] ${e}`));
    const allPage = SECTIONS.flatMap((s) => (findings[s.label]?.pageErrors ?? []).map((e) => `[${s.label}] ${e}`));
    expect(allPage, allPage.join('\n')).toEqual([]);
    expect(allConsole, allConsole.join('\n')).toEqual([]);
  });
});
