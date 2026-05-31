/**
 * Prod E2E config — runs `*.e2e.ts` specs against the live site with a real
 * Chromium (the default `playwright.config.ts` targets localhost + `*.spec.ts`
 * with mocked fixtures; this is separate so the two never collide).
 *
 * Run: `E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test --config=playwright.prod.config.ts`
 * The spec seeds `ps_session` from `E2E_API_KEY` (a real `psk_test_` API key row
 * in prod D1) so the admin shell authenticates without a backdoor.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  retries: 1,
  reporter: [['line']],
  use: {
    baseURL: process.env.PROD_URL || 'https://projectsites.dev',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
