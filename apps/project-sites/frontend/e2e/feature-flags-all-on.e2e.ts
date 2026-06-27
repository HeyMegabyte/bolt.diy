/**
 * @module e2e/feature-flags-all-on
 *
 * Verifies the directive "ensure ALL feature flags are on and properly working".
 *
 * 1. Enumerate every flag from the public registry (`GET /api/feature-flags`).
 * 2. Assert each one resolves ENABLED (`GET /api/feature-flags/:key` →
 *    `resolved.enabled === true`). Collected so the failure lists EVERY off flag.
 * 3. App-smoke with all flags on: the homepage AND the admin shell load with a
 *    `root`/`app-root` painted and ZERO red console errors — proving that turning
 *    every flag on doesn't break the running app (the "properly working" half).
 *
 * TDD: written BEFORE flipping the flags on, so the flag-state test starts RED
 * (52 experimental flags off) and goes GREEN once the global overrides are set.
 *
 * Runs against PROD (playwright.prod.config.ts). Admin smoke seeds `ps_session`
 * from E2E_API_KEY; it is skipped (not failed) when the key is absent.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

interface RegistryResponse {
  flags: Array<{ key: string }>;
  count: number;
}
interface Resolution {
  resolved: { enabled: boolean; rollout_percent: number; stage: string };
}

async function allFlagKeys(request: import('@playwright/test').APIRequestContext): Promise<string[]> {
  const res = await request.get('/api/feature-flags');
  expect(res.ok(), 'GET /api/feature-flags should 200').toBeTruthy();
  const body = (await res.json()) as RegistryResponse;
  expect(body.flags.length).toBeGreaterThan(50);
  return body.flags.map((f) => f.key);
}

test('every feature flag resolves ENABLED', async ({ request }) => {
  const keys = await allFlagKeys(request);
  const off: string[] = [];
  for (const key of keys) {
    const res = await request.get(`/api/feature-flags/${encodeURIComponent(key)}`);
    if (!res.ok()) {
      off.push(`${key} (HTTP ${res.status()})`);
      continue;
    }
    const body = (await res.json()) as Resolution;
    if (!body.resolved?.enabled) off.push(key);
  }
  expect(off, `flags still OFF: ${off.join(', ')}`).toHaveLength(0);
});

async function assertCleanRender(page: Page, path: string, rootSel: string): Promise<void> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  // domcontentloaded (NOT networkidle) — the SPA holds open analytics/poll
  // connections so networkidle never settles. Wait on the root element instead.
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  const root = page.locator(rootSel).first();
  await root.waitFor({ state: 'attached', timeout: 20_000 });
  await expect.poll(async () => (await root.innerHTML()).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const html = await root.innerHTML();
  expect(html.length, `${path} ${rootSel} should render content`).toBeGreaterThan(0);
  // Allow benign third-party noise; fail on app-origin errors.
  const appErrors = errors.filter(
    (e) => !/favicon|analytics|posthog|sentry|gtag|third-party|net::ERR/i.test(e),
  );
  expect(appErrors, `console errors on ${path}: ${appErrors.join(' | ')}`).toHaveLength(0);
}

test('homepage stays clean with all flags on', async ({ page }) => {
  await assertCleanRender(page, '/', '#root, app-root, body');
});

test('admin shell stays clean with all flags on', async ({ page }) => {
  test.skip(!KEY, 'E2E_API_KEY not set — admin smoke skipped');
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k }));
    } catch {
      /* private mode */
    }
  }, KEY);
  await assertCleanRender(page, '/admin', 'app-root, #root, body');
});
