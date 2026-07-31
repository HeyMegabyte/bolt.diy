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
    'auth-oauth-buttons.spec.ts',          // F001 — Google + GitHub OAuth buttons (Pass 1)
    'auth-and-signin.spec.ts',             // Full auth flow (all 6 methods + 2FA)
    'admin-journey.spec.ts',               // Admin shell journey (Pass 6)
    'admin-sections-smoke.spec.ts',        // 15 admin section redirect checks + API health (Pass 7)
    'marketing-seo.spec.ts',               // 9 route SEO metadata + critical files (Pass 7)
    'security-headers-extended.spec.ts',   // HSTS, CSP, CORS, security posture (Pass 7)
    'auth-signup-oauth.spec.ts',           // Sign-up Google + GitHub OAuth buttons (Pass 8/14)
    'admin-social.spec.ts',                // Social + 8 admin section redirects (Pass 11)
    'admin-sysadmin.spec.ts',              // Sysadmin + system-services + subdomain probes (Pass 17)
    'admin-site-detail.spec.ts',           // Site detail routes + subdomain landing pages (Pass 18)
    'integration-health.spec.ts',          // 8 probes across all services (Pass 9)
    'feature-flags.spec.ts',               // Public API + admin auth gates (Pass 9)
    'accessibility.spec.ts',               // 8 routes × 6bp axe-core WCAG 2.2 AA (Pass 9)
    'admin-voice-billing.spec.ts',         // Voice + billing auth gates + API smoke (Pass 21)
    'admin-dashboard.spec.ts',             // First authenticated dashboard journey (Convergence Pass 1)
    'admin-*-journey.spec.ts',             // 12 authenticated section journeys (Convergence Pass 2)
    'admin-feature-flags.spec.ts',         // sysAdmin feature-flags journey (Convergence Pass 2)
    'value-domains-*.spec.ts',             // TDD Contract #10 value-domain suites (Convergence Pass 3)
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
