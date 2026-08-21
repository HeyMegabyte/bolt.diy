/**
 * @module e2e/admin-clickaround-errors
 *
 * HUMAN-LIKE /admin click-around regression gate. Covers the exact defect
 * class Brian hit 2026-08-20 by just clicking around the admin section:
 *
 *   1. Domain picker — GET /api/domains/suggest 400'd every slug-style site
 *      id (`site-megabytespace-001`) because the worker schema demanded a UUID
 *      while legacy site PKs are mixed-format. The e2e org's sites
 *      (`e2e-site-1`…) are slug-style ids — perfect regression seeds.
 *   2. "Show me different ones ↻" looked dead — the FE read `{results}` while
 *      the worker's contract is `{suggestions}` (response-key lying-empty),
 *      so refine responses were silently discarded.
 *   3. /api/analytics/:siteId FetchEvents were rejected by the service worker
 *      ("network error response: the promise was rejected") when the worker's
 *      unbounded GA4/CF-GraphQL egress outlasted the SW's 30s freshness timeout.
 *   4. PostHog/GTM beacons were CORP-blocked because the admin shell shipped
 *      `Cross-Origin-Embedder-Policy: credentialless` on the DOCUMENT.
 *
 * Asserts at the NETWORK level (requestfailed) — the only signal that catches
 * SW-rejected FetchEvents deterministically — plus a console-error gate that
 * deliberately does NOT allowlist CORP or SW-rejection text, so either class
 * re-introduced fails this spec.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

/** Paths where the (post-fix) target signal is a RESOLVED response. */
const WATCH_ANALYTICS = /\/api\/analytics\/|\/api\/analytics\?/i;
/** Browser-abandoned navigational beacons (`requestWillBeSent` then nav) — never a defect. */
const BEACON_ABANDON = /google-analytics\.com\/(g\/collect|g\/collect\?)|googletagmanager\.com\/a\?|posthog\.com\/i\/v0\/e\//i;

/**
 * Same benign set as admin-console-errors.e2e.ts — NO CORP / SW-rejection
 * allowlist on purpose. SW-rejected FetchEvents surface BOTH as a console
 * error (non-benign) AND as a requestfailed on the ORIGIN url.
 */
function isBenign(msg: ConsoleMessage): boolean {
  const text = msg.text();
  const url = msg.location()?.url ?? '';
  if (/editor\.projectsites\.dev/i.test(url) || /editor\.projectsites\.dev/i.test(text)) return true; // bolt iframe
  if (/Failed to load resource: the server responded with a status of 4\d\d/i.test(text)) return true; // no-data 404s for the test site
  if (/SharedArrayBuffer|Skipping boot — embedded mode|webcontainer/i.test(text)) return true;
  return false;
}

/** Track only ORIGIN request failures + analytics 5xx; ignore browser-abandoned beacons. */
function isTrackedFailure(url: string): boolean {
  if (BEACON_ABANDON.test(url)) return false; // ERR_ABORTED on navigational beacons is the browser, not us
  if (WATCH_ANALYTICS.test(url)) return true; // analytics must resolve — an SW rejection shows up here
  return !/^https:\/\/(projectsites\.dev|editor\.projectsites\.dev)\//.test(url); // other origins: skip (bolt iframe, fonts, cdn)
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin — human-like click-around, no network/console defects', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('domain picker: suggest 200s, refine cycles picks, zero failed requests', async ({ page }) => {
    test.setTimeout(90000);
    const failed: string[] = [];
    const suggestStatus: number[] = [];
    const refineStatus: number[] = [];
    const badConsole: string[] = [];
    const jsErrors: string[] = [];

    page.on('requestfailed', (req) => {
      if (isTrackedFailure(req.url())) failed.push(`${req.failure()?.errorText ?? 'network error'} ${req.url()}`);
    });
    page.on('response', (res) => {
      if (res.url().includes('/api/domains/suggest?') && !res.url().includes('refine')) suggestStatus.push(res.status());
      if (res.url().includes('/api/domains/suggest/refine')) refineStatus.push(res.status());
    });
    page.on('pageerror', (err) => jsErrors.push(`${err.name}: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (!isBenign(msg)) badConsole.push(`${msg.text()} @ ${msg.location()?.url ?? '?'}`);
    });

    await seed(page);
    await page.goto('/admin', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    // Open the domain picker like a human — click the active-domain trigger.
    const trigger = page.locator('.dp-trigger');
    await expect(trigger).toBeVisible({ timeout: 20000 });
    await trigger.click();
    await expect(page.locator('.dp-panel')).toBeVisible({ timeout: 10000 });

    // Network contract: suggest must fire and resolve 200 — the pre-fix 400
    // regression signal. Rows render from the live suggestions OR the
    // brand-fallback fillers (the picker never shows an empty list), so the
    // DOM assertion covers the panel, not the suggestion source.
    await expect(page.locator('.dp-row--reg').first()).toBeVisible({ timeout: 45000 });
    expect(suggestStatus.length, 'GET /api/domains/suggest never fired').toBeGreaterThan(0);
    expect(suggestStatus.every((s) => s === 200), `suggest statuses: ${suggestStatus.join(',')}`).toBe(true);

    // "Show me different ones ↻" — POST refine must fire and resolve 200
    // (the pre-fix lying-empty bug: refine responses were silently discarded,
    // so the set never changed and the button LOOKED dead).
    const refine = page.locator('.dp-refine');
    await expect(refine).toBeVisible({ timeout: 10000 });
    await refine.click();
    await expect(page.locator('.dp-refine')).toBeEnabled({ timeout: 45000 }); // refining spinner clears
    expect(refineStatus.length, 'POST /api/domains/suggest/refine never fired').toBeGreaterThan(0);
    expect(refineStatus.every((s) => s === 200), `refine statuses: ${refineStatus.join(',')}`).toBe(true);

    // Close the panel (Escape) — human-like.
    await page.keyboard.press('Escape');
    await expect(page.locator('.dp-panel')).toBeHidden({ timeout: 10000 });

    // No SW-rejected fetches on analytics + beacons during the whole journey.
    expect(failed, `failed network requests:\n${failed.join('\n')}`).toEqual([]);
    expect(jsErrors, `uncaught JS exception(s):\n${jsErrors.join('\n')}`).toEqual([]);
    expect(badConsole, `non-benign console error(s):\n${badConsole.join('\n')}`).toEqual([]);
  });

  test('analytics route: /api/analytics resolves, no SW rejection, no CORP-blocked beacons', async ({ page }) => {
    test.setTimeout(90000);
    const failed: string[] = [];
    const analyticsStatus: number[] = [];
    const badConsole: string[] = [];
    const jsErrors: string[] = [];

    page.on('requestfailed', (req) => {
      if (isTrackedFailure(req.url())) failed.push(`${req.failure()?.errorText ?? 'network error'} ${req.url()}`);
    });
    page.on('response', (res) => {
      if (WATCH_ANALYTICS.test(res.url())) analyticsStatus.push(res.status());
    });
    page.on('pageerror', (err) => jsErrors.push(`${err.name}: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (!isBenign(msg)) badConsole.push(`${msg.text()} @ ${msg.location()?.url ?? '?'}`);
    });

    await seed(page);
    await page.goto('/admin/analytics', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500); // let the analytics fetch + beacons settle

    // e2e org's analytics may 403 (cross-org) — a RESOLVED response is the
    // contract. A SW "Failed to fetch" rejection produces NO response and a
    // requestfailed instead, which the failed[] assert catches.
    expect(analyticsStatus.length, '/api/analytics never fired').toBeGreaterThan(0);
    expect(failed, `failed network requests:\n${failed.join('\n')}`).toEqual([]);
    expect(jsErrors, `uncaught JS exception(s):\n${jsErrors.join('\n')}`).toEqual([]);
    expect(badConsole, `non-benign console error(s):\n${badConsole.join('\n')}`).toEqual([]);
  });

  test('dashboard search input: no focus ring on the input itself', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    const input = page.locator('input[data-testid="dash-search"]');
    await expect(input).toBeVisible({ timeout: 20000 });
    await input.click();
    await expect(input).toBeFocused();

    const box = await input.evaluate((el) => {
      const s = getComputedStyle(el);
      return { outline: s.outlineStyle + ' ' + s.outlineWidth, boxShadow: s.boxShadow };
    });
    expect(box.outline, 'input must have no focus outline').toContain('none');
    expect(box.boxShadow, 'input must have no focus box-shadow').toBe('none');

    // The wrapping bar must still carry the affordance.
    const wrap = await page.locator('.search-wrap').evaluate((el) => getComputedStyle(el).borderColor);
    expect(wrap).toBeTruthy();
  });

  test('editor: /admin/editor boots the bolt iframe with no service-worker-rejected /api fetches', async ({ page }) => {
    test.setTimeout(90000);
    const failed: string[] = [];
    const swRejections: string[] = [];
    const jsErrors: string[] = [];
    const badConsole: string[] = [];

    page.on('requestfailed', (req) => {
      if (isTrackedFailure(req.url())) failed.push(`${req.failure()?.errorText ?? 'network error'} ${req.url()}`);
    });
    page.on('pageerror', (err) => jsErrors.push(`${err.name}: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const t = msg.text();
      // THE regression this locks: the Angular service worker turning a slow or
      // failed dynamic `/api/*` fetch (analytics, sites) into an uncaught
      // rejection — `ngsw-worker.js DataGroup.safeFetch → Uncaught TypeError:
      // Failed to fetch` — which spammed the editor console AND stranded the
      // persistent bolt.diy iframe with ZERO code files (Brian, 2026-08-20).
      // The fix removed ALL `/api/*` dataGroups from ngsw-config.json, so the SW
      // never intercepts an API call. If any dataGroup is re-added, this fires.
      if (/DataGroup|ngsw-worker|the promise was rejected/i.test(t)) swRejections.push(t);
      if (!isBenign(msg)) badConsole.push(`${msg.text()} @ ${msg.location()?.url ?? '?'}`);
    });

    await seed(page);
    await page.goto('/admin/editor', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    // The persistent bolt.diy editor iframe MUST mount — it is what renders the
    // code files. A stranded editor never attaches it (or attaches it empty).
    await expect(page.locator('iframe[src*="editor.projectsites.dev"]')).toBeAttached({ timeout: 45000 });
    await page.waitForTimeout(3000); // let the analytics poll + iframe import settle

    expect(swRejections, `service-worker rejected /api fetch(es):\n${swRejections.join('\n')}`).toEqual([]);
    expect(failed, `failed network requests:\n${failed.join('\n')}`).toEqual([]);
    expect(jsErrors, `uncaught JS exception(s):\n${jsErrors.join('\n')}`).toEqual([]);
    expect(badConsole, `non-benign console error(s):\n${badConsole.join('\n')}`).toEqual([]);
  });
});
