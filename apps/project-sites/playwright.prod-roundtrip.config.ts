import { defineConfig, devices } from '@playwright/test';

/**
 * MANUAL-ONLY config for the real magic-link roundtrip suite.
 *
 * The roundtrip spec sends 2 REAL emails to test@megabyte.space per run, so it
 * is deliberately excluded from playwright.prod.config.ts testMatch (CLI file
 * args are filtered against testMatch, so passing the file to the main config
 * silently runs nothing). Run it via:
 *
 *   export E2E_PEEK_SECRET=$( (/usr/bin/grep -m1 '^E2E_PEEK_SECRET=' \
 *     /Users/Apple/.local/share/e2e-secrets.env 2>/dev/null || \
 *     /usr/bin/grep -m1 '^E2E_PEEK_SECRET=' $HOME/.e2e-peek-secret.env) | cut -d= -f2 )
 *   npx playwright test --config=playwright.prod-roundtrip.config.ts --workers=1
 *
 * Never add this to CI cron schedules — real emails per run.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['auth-magic-link-roundtrip.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: process.env.PROD_URL ?? 'https://projectsites.dev',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
