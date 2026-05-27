/**
 * Lighthouse CI config for `apps/web`.
 *
 * Budgets follow `~/.claude/plugins/heymegabyte-claude-skills/rules/`
 * `quality-metrics.md` and the cinematic-website doctrine §13:
 *   - LCP ≤ 2.0s (cinematic) / 2.5s (hard ceiling)
 *   - CLS ≤ 0.05
 *   - INP / TBT — proxy via `total-blocking-time` (≤ 200ms)
 *   - JS ≤ 250 KB gz per chunk; total ≤ 350 KB gz
 *   - Accessibility ≥ 95
 *   - SEO ≥ 95
 *   - Best-practices ≥ 95
 *   - Performance ≥ 75 (Lighthouse aggregate; CWV gates are the source
 *     of truth — score is the smoke check)
 *
 * Run via `npx lhci autorun --config=apps/web-e2e/lighthouserc.cjs` after
 * `nx build web --configuration=production` completes.
 */

/** @type {import('@lhci/cli').Config} */
module.exports = {
  ci: {
    collect: {
      // Spin up the Express SSR build for measurement.
      startServerCommand: 'node dist/apps/web/server/server.mjs',
      url: [
        'http://localhost:4000/',
        'http://localhost:4000/about',
        'http://localhost:4000/pricing',
        'http://localhost:4000/dashboard',
        'http://localhost:4000/blog/launching-projectsites',
        'http://localhost:4000/docs/getting-started',
        'http://localhost:4000/templates/saas-landing',
      ],
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        chromeFlags: '--no-sandbox --headless=new',
        // Throttling: simulate the typical paid-Workers edge POP — fast TTFB,
        // moderate CPU. Matches what real users see post-deploy.
        throttling: {
          rttMs: 35,
          throughputKbps: 16384,
          cpuSlowdownMultiplier: 1,
        },
        screenEmulation: {
          mobile: false,
          width: 1280,
          height: 800,
          deviceScaleFactor: 1,
          disabled: false,
        },
        skipAudits: ['uses-http2'],
      },
    },

    assert: {
      assertions: {
        /* ---- Core Web Vitals -------------------------------------- */
        'largest-contentful-paint': ['error', { maxNumericValue: 2000 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
        'total-blocking-time': ['error', { maxNumericValue: 200 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 1500 }],
        'speed-index': ['warn', { maxNumericValue: 2200 }],
        interactive: ['warn', { maxNumericValue: 3000 }],
        'server-response-time': ['error', { maxNumericValue: 350 }],

        /* ---- Resource budgets ------------------------------------- */
        'total-byte-weight': ['error', { maxNumericValue: 1_500_000 }],
        'unused-javascript': ['warn', { maxNumericValue: 50_000 }],
        'render-blocking-resources': ['warn', { maxNumericValue: 0 }],
        'unminified-javascript': ['error', { maxNumericValue: 0 }],
        'unminified-css': ['error', { maxNumericValue: 0 }],
        'modern-image-formats': 'error',
        'uses-text-compression': 'error',
        'uses-responsive-images': 'warn',
        'efficient-animated-content': 'warn',
        'offscreen-images': 'warn',

        /* ---- Categories ------------------------------------------- */
        'categories:performance': ['error', { minScore: 0.75 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 0.95 }],
        'categories:pwa': ['warn', { minScore: 0.8 }],

        /* ---- Accessibility — hard gates --------------------------- */
        'color-contrast': 'error',
        'image-alt': 'error',
        label: 'error',
        'aria-required-attr': 'error',
        'aria-valid-attr': 'error',
        'meta-viewport': 'error',
        tabindex: 'error',

        /* ---- SEO hard gates --------------------------------------- */
        'meta-description': 'error',
        'document-title': 'error',
        'hreflang': 'warn',
        'crawlable-anchors': 'error',
        'is-crawlable': 'error',
        'structured-data': 'warn',
      },
    },

    upload: {
      target: 'temporary-public-storage',
    },

    /* ---- Resource budgets (per-resource type) --------------------- */
    budgets: [
      {
        path: '/*',
        resourceSizes: [
          { resourceType: 'script', budget: 250 },
          { resourceType: 'stylesheet', budget: 60 },
          { resourceType: 'image', budget: 500 },
          { resourceType: 'font', budget: 100 },
          { resourceType: 'document', budget: 30 },
          { resourceType: 'media', budget: 0 },
          { resourceType: 'third-party', budget: 200 },
          { resourceType: 'total', budget: 1500 },
        ],
        resourceCounts: [
          { resourceType: 'third-party', budget: 10 },
          { resourceType: 'script', budget: 12 },
          { resourceType: 'stylesheet', budget: 4 },
          { resourceType: 'font', budget: 4 },
        ],
      },
    ],
  },
};
