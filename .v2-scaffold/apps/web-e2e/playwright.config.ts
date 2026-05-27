import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

/**
 * Resolved base URL — override with BASE_URL env var for deployed targets.
 */
const baseURL = process.env['BASE_URL'] || 'http://localhost:4200';

export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),

  /* ------------------------------------------------------------------ */
  /* Global settings                                                      */
  /* ------------------------------------------------------------------ */
  fullyParallel: true,
  workers: process.env['CI'] ? '50%' : '75%',
  retries: process.env['CI'] ? 2 : 0,
  reporter: [
    ['line'],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['html', { open: 'never', outputFolder: 'playwright-report/html' }],
  ],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  /* ------------------------------------------------------------------ */
  /* Web server                                                           */
  /* ------------------------------------------------------------------ */
  webServer: {
    command: 'npx nx run web:serve',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    cwd: workspaceRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  /* ------------------------------------------------------------------ */
  /* Cross-browser matrix — 9 projects                                   */
  /* ------------------------------------------------------------------ */
  projects: [
    // ── Chromium at 5 viewports ──────────────────────────────────────
    {
      name: 'chromium-375',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
      },
    },
    {
      name: 'chromium-768',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: 'chromium-1024',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1024, height: 768 },
      },
    },
    {
      name: 'chromium-1280',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'chromium-1920',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },

    // ── WebKit ───────────────────────────────────────────────────────
    {
      name: 'webkit-1280',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 800 },
      },
    },

    // ── Firefox ──────────────────────────────────────────────────────
    {
      name: 'firefox-1280',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 800 },
      },
    },

    // ── Mobile ───────────────────────────────────────────────────────
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
