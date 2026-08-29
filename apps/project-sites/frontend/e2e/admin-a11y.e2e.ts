/**
 * @module e2e/admin-a11y
 *
 * WCAG 2.2 AA audit of the legacy admin via axe-core. The agentskills mandate
 * is axe 0 violations; this gate scans each key section and fails on
 * serious/critical violations (moderate/minor are reported for triage but not
 * blocking, so the gate is actionable not noisy).
 *
 * PLUS the form-control accessible-name rules (`label`, `select-name`,
 * `aria-input-field-name`) are ALWAYS blocking regardless of axe's impact
 * ranking. axe ranks these "moderate", so the serious/critical filter alone
 * was STATE-BLIND to them — which is exactly why the per-section label-association
 * sweeps were belt-and-suspenders. Now that that sweep is closed + live, promoting
 * these three rules to blocking turns the manual sweep into enforced regression
 * protection (a missing label on any input/select/contenteditable fails the gate).
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';
/** Accessible-name rules promoted to blocking (axe ranks them only "moderate"). */
const NAME_RULES = new Set(['label', 'select-name', 'aria-input-field-name']);
const isBlocking = (impact: string | null | undefined, id: string): boolean =>
  impact === 'critical' || impact === 'serious' || NAME_RULES.has(id);
// Only REAL sections + redirect-aliases that land on a real surface. A path that
// renders the styled "This admin page doesn't exist" 404 card is trivially
// axe-clean, so listing a DEAD route silently reports FALSE coverage — the
// per-section 404-guard below now FAILS on any such entry. Pruned 2026-08-29
// (surf): content-freshness / pseo / ai-endpoints (removed in the Functions
// convergence) / sites / features / inbox / marketplace / trust / enterprise all
// 404 now (no route, no component — site management moved to the dashboard +
// site-switcher; Features lives at /admin/site-features). Redirect aliases KEPT
// because they scan a DISTINCT real surface: feature-flags/seo → site-features,
// api-tokens/domains/webhooks → the matching /admin/settings#tab, traces →
// /admin/logs?tab=traces. The editor bolt.diy iframe is a separate origin
// (excluded via .exclude('iframe')).
const SECTIONS = [
  '/admin/snapshots', '/admin/forms', '/admin/analytics', '/admin/audit',
  '/admin/feature-flags', '/admin/api-tokens', '/admin/settings', '/admin/billing',
  '/admin/voice', '/admin/social', '/admin/domains', '/admin/seo', '/admin/docs',
  '/admin/traces', '/admin/apps', '/admin/user', '/admin/logs',
  // accept-invite renders its no-token error state; stripe-app-status the Stripe
  // connection status; bulk-ops / deliverability / webhooks are real settings surfaces.
  '/admin/accept-invite', '/admin/stripe-app-status',
  '/admin/bulk-ops', '/admin/deliverability', '/admin/webhooks',
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
    test(`no serious/critical or unnamed-control axe violations — ${path}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await seed(page);
      await page.goto(path, { waitUntil: 'load' });
      // 45s: under the parallel per-section run, several heavy admin SPA pages +
      // axe load concurrently, so shell render can lag past a tighter budget
      // (contention, not a real failure — even stable sections flaked at 25s).
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 45000 });
      // 404-guard (surf 2026-08-29): a removed section route renders the styled
      // "This admin page doesn't exist" card, which is trivially axe-clean — so
      // scanning it SILENTLY reports false coverage. Fail loudly instead: every
      // listed path must resolve to a real section (or a redirect to one). This
      // catches BOTH a stale SECTIONS entry AND a real section regressing to a
      // 404 while the axe scan stays green. `.count()` is immediate (the content
      // area has rendered once the sidebar is visible).
      const deadRouteCard = await page
        .getByRole('heading', { name: /this admin page doesn'?t exist/i })
        .count();
      expect(
        deadRouteCard,
        `${path} renders the "dead route" 404 card — remove it from SECTIONS or restore the route (a 404 is trivially axe-clean → false coverage).`,
      ).toBe(0);
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
        // (2026-08-20 perf-wave COMPLETE): the `.ag-root` exclusion is GONE —
        // ag-grid was fully removed (audit + traces grids are TanStack Table),
        // so the aria-required-children violation it forced no longer exists.
        .analyze();
      const advisory = results.violations
        .filter((v) => !isBlocking(v.impact, v.id))
        .map((v) => `${v.impact ?? '?'} · ${v.id} · ${v.nodes.length}×`);
      const blocking = results.violations
        .filter((v) => isBlocking(v.impact, v.id))
        .map((v) => `${v.impact} · ${v.id} · ${v.nodes.length}× · ${v.help}\n      ${v.nodes[0]?.target?.join(' ') ?? ''}`);
      if (advisory.length) console.warn(`\n[${path}] axe ADVISORY: ${advisory.join(' | ')}`);
      console.warn(`\n[${path}] axe BLOCKING (serious/critical): ${blocking.length}${blocking.length ? '\n' + blocking.join('\n') : ' ✓'}`);
      expect(blocking, `${path}\n${blocking.join('\n')}`).toEqual([]);
    });
  }
});
