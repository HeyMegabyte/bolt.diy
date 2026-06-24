/**
 * Prod E2E config — runs `*.e2e.ts` specs against the live site with a real
 * Chromium (the default `playwright.config.ts` targets localhost + `*.spec.ts`
 * with mocked fixtures; this is separate so the two never collide).
 *
 * Run: `E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test --config=playwright.prod.config.ts`
 * The spec seeds `ps_session` from `E2E_API_KEY` (a real `psk_test_` API key row
 * in prod D1) so the admin shell authenticates without a backdoor.
 *
 * Parallel execution: `fullyParallel: true` + `workers` (default 50% of cores,
 * override via `PW_WORKERS`). Every spec is independent + parallel-safe.
 *
 * Cloudflare Browser Rendering: set `CF_BROWSER_WS_ENDPOINT` to a Browser
 * Rendering Playwright WebSocket endpoint and the run drives a remote CF
 * browser instead of a local Chromium — many parallel cloud sessions, no local
 * browser needed. The remote browser reaches the PUBLIC `baseURL` (that's why
 * CF Browser lives here and not in the localhost dev config). Inert when unset.
 *   CF_BROWSER_WS_ENDPOINT="wss://…browser-rendering…" \
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

const cfBrowserWs = process.env.CF_BROWSER_WS_ENDPOINT;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  workers: process.env.PW_WORKERS || '50%',
  // 2 retries: this targets the LIVE site whose persistent editor iframe adds
  // first-load network time, so the first attempt can be timing-flaky.
  retries: 2,
  reporter: [['line']],
  use: {
    baseURL: process.env.PROD_URL || 'https://projectsites.dev',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Drive a remote Cloudflare Browser Rendering instance when configured;
    // otherwise launch a local Chromium. Connecting to a shared remote browser
    // lets the whole suite fan out across CF's browser fleet in parallel.
    ...(cfBrowserWs ? { connectOptions: { wsEndpoint: cfBrowserWs } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
