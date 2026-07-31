import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Prod smoke set — broadened from voice-only. The feature-journey + adversarial
  // suites do a REAL login via E2E_API_KEY (helpers/auth.ts Pathway C) and browse
  // every admin feature against the live URL. Set E2E_API_KEY in CI.
  // ⚠️ Basename semantics: Playwright prepends '**/' to any testMatch string, so a
  // bare 'name.spec.ts' matches at ANY depth under testDir — including stale twins
  // in e2e/admin/. Entries whose basename recurs in a subdir MUST be anchored with
  // an explicit 'e2e/'-relative glob (see the two anchored entries below).
  testMatch: [
    'feature-journey.spec.ts',
    'health.spec.ts',
    'golden-path.spec.ts',
    'e2e/voice.spec.ts',                   // ANCHORED: bare 'voice.spec.ts' also pulled in e2e/admin/voice.spec.ts (stale, deleted)
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
    'e2e/feature-flags.spec.ts',           // ANCHORED (bare basename also pulled in e2e/admin/feature-flags.spec.ts, stale, deleted) — Public API + admin auth gates (Pass 9)
    'accessibility.spec.ts',               // 8 routes × 6bp axe-core WCAG 2.2 AA (Pass 9)
    'admin-voice-billing.spec.ts',         // Voice + billing auth gates + API smoke (Pass 21)
    'admin-dashboard.spec.ts',             // First authenticated dashboard journey (Convergence Pass 1)
    'admin-*-journey.spec.ts',             // 12 authenticated section journeys (Convergence Pass 2)
    'admin-logs-journey.spec.ts',          // Logs dashboard tabs journey — audit + explorer + filter + pagination (also matched by the glob above)
    'admin-api-tokens-journey.spec.ts',    // API tokens one-time-reveal + value-domains + revoke journey (also matched by the glob above)
    'admin-feature-flags.spec.ts',         // sysAdmin feature-flags journey (Convergence Pass 2)
    'value-domains-*.spec.ts',             // TDD Contract #10 value-domain suites (Convergence Pass 3)
    'auth-session-lifecycle.spec.ts',      // Sign-out / expiry / 429 / reload (Convergence Pass 8)
    // auth-magic-link-roundtrip.spec.ts is EXCLUDED on purpose: it sends 2 REAL
    // emails per run — run manually with E2E_PEEK_SECRET + --workers=1 only.
    'admin-user-settings-journey.spec.ts', // /admin/user profile + display-name value domains (settings-security wave; also matched by the admin-*-journey glob)
    'admin-auth-security-journey.spec.ts', // /admin/auth-security sessions + revoke + 2FA entry (settings-security wave; also matched by the admin-*-journey glob)
    'admin/review-links.spec.ts',          // ANCHORED subdir path (→ '**/admin/review-links.spec.ts') — Share-link dialog journey, modernized from the removed /admin/review-links page (stale-7 triage 2026-07-31). The other 6 stale e2e/admin twins (bulk-ops, recipes, ai-chat-extras, email, seo, mcp) were DELETED: surfaces removed or relocated into Settings tabs already covered by admin-settings-journey + ai-chat-context.
    // Flag-verification suites (site_analytics, pwa_manifest_full,
    // site_mcp_server, pseo_matrix_v2, unified_inbox, email_deliverability
    // _wizard, outbound_webhooks, site_video_gen) are NOT wired yet: their 9
    // evidence specs failed 33/55 live on 2026-07-31 (stale vs current
    // product — never previously executed). Modernize per Pass-14 queue,
    // wire back one-by-one as each goes green, THEN bump its flag to beta.
  ],
  // (Pass 5: former wave-4 TDD-RED exclusions all greened and re-included.)
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
