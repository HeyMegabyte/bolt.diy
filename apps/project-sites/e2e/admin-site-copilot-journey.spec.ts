/**
 * Admin — Site Copilot Journey (STRICT — zero soft-guards)
 *
 * Covers /admin/sites/:id/copilot — the Multimodal AI Site Copilot admin
 * panel, flag-gated by `multimodal_copilot`. The component reads siteId from
 * the ROUTE (:id on the flat `sites/:id/copilot` route), so we navigate
 * directly to /admin/sites/e2e-site-001/copilot — the ONE site the auth
 * helper stubs into the sites list.
 *
 * Flag reality (greped from site-copilot.component.ts): this surface does NOT
 * consult /api/feature-flags client-side. The WORKER's flag gate answers 404
 * on /api/sites/:id/copilot/config + /sessions when `multimodal_copilot` is
 * off, and the component maps any 404 → flagEnabled=false → the calm
 * <app-flag-gate-notice testid="copilot-flag-gate"> (shell + header stay
 * mounted; per-site toggle locks). We still register the /api/feature-flags
 * override twins in the ON test per the flag-override contract — they keep
 * any client-side reader deterministic, but the load-bearing stubs are the
 * copilot endpoints themselves.
 *
 * Contract:
 * - signInAsTestUser(page) FIRST; section stubs register AFTER it so they win
 *   reverse-match order over the auth helper's benign `**` catch-all (whose
 *   `{"data":[]}` shape would otherwise trip the sessions Array.isArray guard
 *   into the retry error card).
 * - ALL mutations intercepted; the enable-toggle PUT is captured and its body
 *   asserted.
 * - Glob law: mid-token `**` cannot cross '/', so /api/sites/:id/copilot gets
 *   its `/**` subpath twin (config + sessions live under it).
 */
import { test, expect, type Page } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

interface CapturedMutation {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/**
 * Deterministic sessions payload. Shape mirrors the worker's
 * GET /api/sites/:id/copilot/sessions response the component parses in
 * loadSessions(): `{ sessions: CopilotSession[]; distribution: IntentDistRow[] }`.
 * Three rows exercise the signal chips (T/A/I), both latency formats
 * (<1000 → "640ms", ≥1000 → "1.8s"), the null-intent → "unknown" branch, and
 * the done/error status dots.
 */
const SESSIONS_PAYLOAD = {
  sessions: [
    {
      id: 'cs-001',
      intent: 'book',
      has_text: 1,
      has_audio: 0,
      has_image: 1,
      total_ms: 640,
      status: 'done',
      created_at: '2026-07-30T22:00:00Z',
    },
    {
      id: 'cs-002',
      intent: 'quote',
      has_text: 1,
      has_audio: 1,
      has_image: 0,
      total_ms: 1830,
      status: 'done',
      created_at: '2026-07-30T21:00:00Z',
    },
    {
      id: 'cs-003',
      intent: null,
      has_text: 1,
      has_audio: 0,
      has_image: 0,
      total_ms: 95,
      status: 'error',
      created_at: '2026-07-30T20:00:00Z',
    },
  ],
  distribution: [
    { intent: 'book', count: 1 },
    { intent: 'quote', count: 1 },
    { intent: 'unknown', count: 1 },
  ],
};

/** The worker's honest flag-off answer for the copilot endpoints. */
const NOT_FOUND_BODY = JSON.stringify({
  error: { code: 'NOT_FOUND', message: 'Not found', request_id: 'e2e-copilot-404' },
});

/**
 * Registers the section's deterministic stubs. MUST run AFTER
 * signInAsTestUser(page) — Playwright matches routes in reverse registration
 * order, so these override the auth helper's benign catch-all AND its
 * /api/feature-flags continue() pass-throughs.
 * Returns the array that accumulates captured copilot mutations.
 */
async function installCopilotStubs(page: Page, opts: { flagOn: boolean }): Promise<CapturedMutation[]> {
  const mutations: CapturedMutation[] = [];

  // ALL mutations intercepted with a benign 200; GETs fall through to the
  // more-specific handlers below or to the auth helper's routes.
  // glob-ok: deliberate catch-all, mutation-only fulfill.
  await page.route('**/api/**', (route) => {
    const m = route.request().method();
    if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.fallback();
  });

  // Flag override — force `multimodal_copilot` to the test's state for any
  // client-side reader. Query-suffix glob + '/**' twin (glob law: mid-token
  // ** cannot cross '/'); every other flag key falls through to the auth
  // helper's continue() → real prod state stays authoritative for them.
  const flagResolution = JSON.stringify({
    resolved: {
      enabled: opts.flagOn,
      rollout_percent: opts.flagOn ? 100 : 0,
      stage: opts.flagOn ? 'stable' : 'experimental',
      source: 'override',
    },
  });
  const flagHandler = (route: import('@playwright/test').Route) => {
    const url = route.request().url();
    if (route.request().method() === 'GET' && url.includes('/api/feature-flags/multimodal_copilot')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: flagResolution });
    }
    return route.fallback();
  };
  await page.route('**/api/feature-flags**', flagHandler);
  await page.route('**/api/feature-flags/**', flagHandler);

  // Copilot endpoints — config + sessions live on subpaths of
  // /api/sites/:id/copilot, so the '/**' twin is the load-bearing glob; the
  // query-suffix base glob is registered for completeness (no bare endpoint).
  const copilotHandler = (route: import('@playwright/test').Route) => {
    const req = route.request();
    const url = req.url();

    // Flag OFF → the worker 404s every copilot endpoint (server guard).
    if (!opts.flagOn) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: NOT_FOUND_BODY });
    }

    if (req.method() === 'GET' && url.includes('/copilot/config')) {
      // Enabled=false so the journey exercises the false→true toggle.
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' });
    }
    if (req.method() === 'PUT' && url.includes('/copilot/config')) {
      mutations.push({ url, method: 'PUT', body: req.postDataJSON() as Record<string, unknown> | null });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (req.method() === 'GET' && url.includes('/copilot/sessions')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SESSIONS_PAYLOAD),
      });
    }
    return route.fallback();
  };
  await page.route('**/api/sites/e2e-site-001/copilot**', copilotHandler);
  await page.route('**/api/sites/e2e-site-001/copilot/**', copilotHandler);

  return mutations;
}

/** Attach a console-error collector BEFORE navigation. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Filter out third-party/network noise that isn't an app defect. */
function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('third-party') &&
      !e.includes('ERR_BLOCKED_BY_CLIENT') &&
      !e.toLowerCase().includes('failed to load resource'),
  );
}

/** Navigate to the copilot child route and wait for the section to mount. */
async function openCopilot(page: Page): Promise<void> {
  await page.goto(`${PROD_URL}/admin/sites/e2e-site-001/copilot`, {
    waitUntil: 'domcontentloaded',
    timeout: 25_000,
  });
  expect(page.url()).not.toContain('/signin');
  await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
  // Scroll-nudge triggers appReveal (opacity: 0 on mount).
  await page.mouse.wheel(0, 200);
  await expect(
    page.locator('app-admin-site-copilot').getByRole('heading', { name: 'Multimodal AI Copilot' }),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe('Admin — Site Copilot (authenticated journey)', () => {
  test('flag OFF — calm gate notice renders, shell intact, toggle locked, no crash', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    await installCopilotStubs(page, { flagOn: false });
    await openCopilot(page);

    const root = page.locator('app-admin-site-copilot');

    // The calm flag-gate notice is the rendered OFF path (component maps the
    // worker 404s → flagEnabled=false) — never a crash, never a blank shell.
    const gate = page.locator('[data-testid="copilot-flag-gate"]');
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(gate).toContainText('Platform flag');
    await expect(gate).toContainText('The Multimodal Copilot');

    // The gated body (sessions table) does NOT mount while off.
    await expect(page.locator('[data-testid="copilot-table-scroll"]')).toHaveCount(0);

    // Per-site enable toggle is locked (checkbox disabled + unchecked).
    const toggleInput = page.locator('[data-testid="copilot-enable-toggle"] input');
    await expect(toggleInput).toBeDisabled();
    await expect(toggleInput).not.toBeChecked();
    await expect(page.locator('[data-testid="copilot-enable-state"]')).toHaveText('Disabled');

    // Header + admin shell stayed intact around the notice.
    await expect(root.getByRole('heading', { name: 'Multimodal AI Copilot' })).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/site-copilot/flag-off.png', fullPage: true });
    await checkA11y(page, 'site-copilot-flag-off');

    expect(realErrors(errors)).toEqual([]);
  });

  test('flag ON — sessions render from stubbed API; enable toggle PUTs the config mutation', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    const mutations = await installCopilotStubs(page, { flagOn: true });
    await openCopilot(page);

    const root = page.locator('app-admin-site-copilot');

    // Gate notice absent — the real surface mounted.
    await expect(page.locator('[data-testid="copilot-flag-gate"]')).toHaveCount(0);

    // Exactly the 3 stubbed session rows (skeletons resolved, no error row).
    const table = page.locator('[data-testid="copilot-table-scroll"]');
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="copilot-load-error"]')).toHaveCount(0);
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(3, { timeout: 15_000 });

    // Intent chips incl. the null→unknown branch; both latency formats;
    // status dots for done + error.
    await expect(table).toContainText('book');
    await expect(table).toContainText('quote');
    await expect(table).toContainText('unknown');
    await expect(table).toContainText('640ms');
    await expect(table).toContainText('1.8s');
    await expect(table.locator('.copilot-status-dot.done')).toHaveCount(2);
    await expect(table.locator('.copilot-status-dot.error')).toHaveCount(1);

    // Stats strip settles on the stubbed totals (rolling counters finish <1s).
    await expect(root.locator('.copilot-stats')).toContainText('3 sessions', { timeout: 15_000 });
    await expect(root.locator('.copilot-stats')).toContainText('Total');

    await page.screenshot({ path: 'e2e/screenshots/site-copilot/flag-on.png', fullPage: true });
    await checkA11y(page, 'site-copilot-flag-on');

    // ── Interaction: enable the copilot — captured PUT + optimistic UI. ──
    const toggle = page.locator('[data-testid="copilot-enable-toggle"]');
    const toggleInput = toggle.locator('input');
    await expect(toggleInput).toBeEnabled();
    await expect(toggleInput).not.toBeChecked();
    await expect(page.locator('[data-testid="copilot-enable-state"]')).toHaveText('Disabled');

    await toggle.click();

    // State label flips only after the PUT resolves → capture is complete.
    await expect(page.locator('[data-testid="copilot-enable-state"]')).toHaveText('Enabled');
    await expect(toggleInput).toBeChecked();
    expect(mutations).toHaveLength(1);
    expect(mutations[0].method).toBe('PUT');
    expect(mutations[0].url).toContain('/api/sites/e2e-site-001/copilot/config');
    expect(mutations[0].body).toMatchObject({ enabled: true });

    await page.screenshot({ path: 'e2e/screenshots/site-copilot/enabled.png' });

    expect(realErrors(errors)).toEqual([]);
  });

  test('unauthenticated access redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/sites/e2e-site-001/copilot`);
    await page.waitForURL('**/signin**', { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="sign-in-page"], [data-testid="auth-container"], form').first(),
    ).toBeVisible();
  });
});
