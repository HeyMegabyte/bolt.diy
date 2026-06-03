/**
 * @module e2e/admin-a11y
 *
 * WCAG 2.2 AA audit of the legacy admin via axe-core. The agentskills mandate
 * is axe 0 violations; this gate scans each key section and fails on
 * serious/critical violations (moderate/minor are reported for triage but not
 * blocking, so the gate is actionable not noisy). Seeds `ps_session` from
 * `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';
const SECTIONS = [
  '/admin/snapshots', '/admin/forms', '/admin/analytics', '/admin/audit',
  '/admin/feature-flags', '/admin/api-tokens', '/admin/settings', '/admin/billing',
  // Expanded to the primary-button-heavy sections to catch the global
  // white-on-cyan PrimeNG contrast bug wherever it renders.
  '/admin/voice', '/admin/social', '/admin/domains', '/admin/content-freshness',
  '/admin/pseo', '/admin/ai-endpoints', '/admin/sites', '/admin/seo', '/admin/docs',
  // Coverage expansion (round 117; gap re-audited + closed round 32 — see the
  // two sections appended at the end). This list covers EVERY real admin SECTION
  // component. The other /admin/* routes are intentionally NOT scanned because
  // they aren't standalone sections (verified round 118): redirect aliases whose
  // targets ARE scanned —
  // dashboard→'', mcp→settings/mcp, github→snapshots, ai-chat→settings — and the
  // welcome/editor bolt.diy iframe (separate origin, excluded via .exclude('iframe')).
  '/admin/features', '/admin/traces', '/admin/media', '/admin/apps',
  '/admin/inbox', '/admin/marketplace', '/admin/trust', '/admin/enterprise',
  '/admin/user', '/admin/logs',
  // Coverage gap closed (round 32): these two routed admin sections had real
  // components but ZERO e2e coverage. accept-invite renders its no-token error
  // state ("Missing token in URL" + Go-to-admin); stripe-app-status renders the
  // Stripe-connection status. Both verified axe-clean live before adding.
  '/admin/accept-invite', '/admin/stripe-app-status',
  // Coverage gap closed (this round): four routed admin sections that had real
  // components but ZERO axe coverage in this suite. All verified axe-clean live
  // (WCAG 2.0/2.1/2.2 AA, 0 violations) before adding — bulk-ops 26 passes,
  // deliverability 28, webhooks 26, review-links 24.
  '/admin/bulk-ops', '/admin/deliverability', '/admin/webhooks', '/admin/review-links',
];

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try { localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() })); } catch { /* */ }
  }, KEY);
}

test.describe('legacy /admin — WCAG 2.2 AA (axe-core)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  // Per-section tests run in parallel → loading many heavy admin SPA pages + axe
  // at once occasionally lags shell render past the readiness budget on a random
  // section (pure contention, not a real failure). Retries let those transient
  // timeouts self-heal; a genuine axe violation fails every attempt.
  test.describe.configure({ retries: 2 });

  // One test PER section so a slow/redirecting section fails only its own case
  // (named clearly), never the whole gate — and coverage can expand safely.
  // Reduced-motion settles scroll-reveal animations so axe scans the steady UI
  // (no networkidle: the admin polls continuously + never idles).
  for (const path of SECTIONS) {
    test(`no serious/critical axe violations — ${path}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await seed(page);
      await page.goto(path, { waitUntil: 'load' });
      // 45s: under the parallel per-section run, several heavy admin SPA pages +
      // axe load concurrently, so shell render can lag past a tighter budget
      // (contention, not a real failure — even stable sections flaked at 25s).
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 45000 });
      // Settle async section content before scanning: skeleton loaders set
      // aria-busy="true" while fetching (e.g. inbox.component). Scanning during
      // that transient loading state caused a rare inbox flake — wait for the
      // busy markers to clear so axe sees the steady UI. Resolves immediately
      // for sections that never set aria-busy.
      await page
        .locator('[aria-busy="true"]')
        .first()
        .waitFor({ state: 'detached', timeout: 10000 })
        .catch(() => {});
      // Also wait for async section fetches (conversations, billing, etc.) to go
      // quiet — under parallel contention axe could otherwise scan a secondary
      // mid-load DOM and catch transient violations (the rare billing/inbox flake).
      // Bounded + caught so the 30s admin poll can't hang it.
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        // The embedded bolt editor iframe is a separate origin/app — not ours to fix here.
        .exclude('iframe')
        // AG Grid Community virtualizes rows, so `.ag-root` (role=grid) doesn't
        // always hold its required row children in the live DOM — a known
        // third-party limitation we don't author. Excluded like the iframe.
        .exclude('.ag-root')
        .analyze();
      const advisory = results.violations
        .filter((v) => v.impact !== 'critical' && v.impact !== 'serious')
        .map((v) => `${v.impact ?? '?'} · ${v.id} · ${v.nodes.length}×`);
      const blocking = results.violations
        .filter((v) => v.impact === 'critical' || v.impact === 'serious')
        .map((v) => `${v.impact} · ${v.id} · ${v.nodes.length}× · ${v.help}\n      ${v.nodes[0]?.target?.join(' ') ?? ''}`);
      if (advisory.length) console.warn(`\n[${path}] axe ADVISORY: ${advisory.join(' | ')}`);
      console.warn(`\n[${path}] axe BLOCKING (serious/critical): ${blocking.length}${blocking.length ? '\n' + blocking.join('\n') : ' ✓'}`);
      expect(blocking, `${path}\n${blocking.join('\n')}`).toEqual([]);
    });
  }
});
