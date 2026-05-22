import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:8787';
const isCI = !!process.env.CI;

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
      { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    ]
  : [
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          launchOptions: {
            executablePath:
              process.env.PLAYWRIGHT_CHROMIUM_PATH ||
              '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
          },
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
  webServer: {
    command: 'node scripts/e2e_server.cjs',
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 15_000,
  },
});
