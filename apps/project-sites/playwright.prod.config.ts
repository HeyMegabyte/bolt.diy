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
    'collab.spec.ts',
    'adversarial/**/*.spec.ts',
    // BLOCKING CWV gate — re-enabled 2026-06-23 (perf loop #14) after the homepage
    // held all-green for 2 fires (fire 8 enabled critical-CSS inlining → FCP 1349→
    // ~460ms; fire 9 confirmed the hold). Asserts LCP≤2000 / CLS≤0.05 / FCP≤1200 on
    // the live marketing homepage under throttled 3G/6×CPU. A CWV regression now
    // fails the prod suite instead of silently shipping. History: started at
    // LCP=9.4s (CSR-only SPA, fire 3) → app-shell static hero (fire 5) → async
    // fonts (fire 5b) → critical-CSS inline (fire 8). Tracked in _PERFECTION_BACKLOG.md Dim I.
    'perf/ttfr.spec.ts',
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
