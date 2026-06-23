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
    'observability_gateway.spec.ts',
    'adversarial/**/*.spec.ts',
    // 'perf/ttfr.spec.ts' — re-enable as a BLOCKING gate once homepage LCP is
    // green (currently ~9.4s on 3G, tracked in _PERFECTION_BACKLOG.md Dim I).
    // Run on demand: npx playwright test e2e/perf/ttfr.spec.ts --config playwright.prod.config.ts
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
