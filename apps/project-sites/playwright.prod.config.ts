import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Prod smoke set — broadened from voice-only. The feature-journey + adversarial
  // suites do a REAL login via E2E_API_KEY (helpers/auth.ts Pathway C) and browse
  // every admin feature against the live URL. Set E2E_API_KEY in CI.
  testMatch: [
    'feature-journey.spec.ts',
    'health.spec.ts',
    'golden-path.spec.ts',
    'voice.spec.ts',
    'adversarial/**/*.spec.ts',
  ],
  fullyParallel: true,
  reporter: 'line',
  use: {
    baseURL: process.env.PROD_URL ?? 'https://projectsites.dev',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
