import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:8787';
const isCI = !!process.env.CI;

// Only boot the local e2e_server when targeting localhost. When BASE_URL points
// at an already-running remote (staging / prod in CI), Playwright must NOT try to
// start + poll a local webServer — doing so hangs 15s then fails the whole E2E run
// with "Timed out waiting from config.webServer" before a single test runs. This
// was the standing blocker on the CI E2E gate (every deploy stalled here).
const useLocalServer = !process.env.BASE_URL || baseURL.includes('localhost');

/**
 * Playwright config — fully parallelized per task #44 of the improvement list.
 *
 * Local dev: 8 workers (typical 8-16 core dev machines run specs in ~25% of
 * the previous serial wall-clock). CI: 4 workers (shared CI runners cap at
 * ~4 cores; going wider creates context contention and flakes).
 *
 * Three browser projects (chromium / firefox / webkit) when `FULL_BROWSER_MATRIX`
 * is set; chromium-only otherwise so the dev inner loop stays fast.
 *
 * @example
 * ```sh
 * FULL_BROWSER_MATRIX=1 npx playwright test --reporter=line
 * BASE_URL=https://projectsites.dev npx playwright test  # against prod
 * ```
 */

const projects = process.env.FULL_BROWSER_MATRIX
  ? [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ]
  : [
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          // Only pin an explicit chromium binary when PLAYWRIGHT_CHROMIUM_PATH is
          // set (some local/container setups). On CI, `npx playwright install`
          // provides the browser at its own managed path — the old hardcoded
          // `/root/.cache/ms-playwright/chromium-1194/...` fallback does NOT exist
          // there and failed EVERY E2E test with "executable doesn't exist" (the
          // browser never launched → the whole suite "failed" with 0 tests run,
          // masquerading as an auth/test cascade). Omitting it = Playwright default.
          ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
            ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
            : {}),
        },
      },
    ];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // 4 workers in CI (cap on shared runners), 8 locally (typical dev cores).
  workers: isCI ? 4 : 8,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    extraHTTPHeaders: { Accept: 'application/json' },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: isCI ? 'retain-on-failure' : 'off',
  },
  projects,
  webServer: useLocalServer
    ? {
        command: 'node scripts/e2e_server.cjs',
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 15_000,
      }
    : undefined,
});
