/**
 * @module e2e/admin-console-errors
 *
 * Broad console-hygiene regression gate enforcing the "zero console errors"
 * done-criterion that the narrow admin-console-hygiene.e2e.ts (favicon +
 * super-admin-401 only) does not cover. Across the core admin routes it fails on:
 *   - ANY uncaught JS exception (`pageerror`) — never allowlisted, always a defect.
 *   - ANY console `error` that is NOT in the known-benign allowlist — this is what
 *     catches a real CSP violation, Trusted-Types violation, or thrown app error.
 *
 * Allowlisted (benign, documented in MEMORY dead-admin-mutation-actions):
 *   - Browser-level "Failed to load resource … 4xx" network logs — the admin
 *     fetches real endpoints that return no-data 404s for the empty test site
 *     (e2e-site-*); pages handle these gracefully. Browser network-error logs
 *     cannot be suppressed from JS, and a real user's populated site 200s.
 *   - Anything originating from the persistent bolt editor iframe
 *     (editor.projectsites.dev) — cross-origin, the editor app's own behavior,
 *     not the admin SPA's.
 *   - The webcontainer "Skipping boot — embedded mode" SharedArrayBuffer warning.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

// Full admin route set — "zero console errors" applies to EVERY route, not a
// sample. Mirrors the scanned set in admin-a11y.e2e.ts.
const ROUTES = [
  '/admin',
  '/admin/sites', '/admin/snapshots', '/admin/forms', '/admin/analytics', '/admin/audit',
  '/admin/feature-flags', '/admin/api-tokens', '/admin/settings', '/admin/billing',
  '/admin/voice', '/admin/social', '/admin/domains', '/admin/content-freshness',
  '/admin/pseo', '/admin/ai-endpoints', '/admin/seo', '/admin/docs',
  '/admin/features', '/admin/traces', '/admin/media', '/admin/apps',
  '/admin/inbox', '/admin/marketplace', '/admin/trust', '/admin/enterprise',
  '/admin/user', '/admin/logs', '/admin/bulk-ops', '/admin/deliverability',
  '/admin/webhooks', '/admin/review-links', '/admin/stripe-app-status',
];

/** True when a console error is a known-benign network/editor-iframe artifact (NOT a real JS/CSP/TT defect). */
function isBenign(msg: ConsoleMessage): boolean {
  const text = msg.text();
  const url = msg.location()?.url ?? '';
  if (/editor\.projectsites\.dev/i.test(url) || /editor\.projectsites\.dev/i.test(text)) return true; // bolt iframe
  if (/Failed to load resource: the server responded with a status of 4\d\d/i.test(text)) return true; // no-data 404s for the test site
  if (/SharedArrayBuffer|Skipping boot — embedded mode|webcontainer/i.test(text)) return true;
  return false;
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin — no real console errors (JS/CSP/Trusted-Types)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  for (const route of ROUTES) {
    test(`${route} logs no uncaught exception or non-benign console error`, async ({ page }) => {
      test.setTimeout(60000);
      const jsErrors: string[] = [];
      const badConsole: string[] = [];
      page.on('pageerror', (err) => jsErrors.push(`${err.name}: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        if (!isBenign(msg)) badConsole.push(`${msg.text()} @ ${msg.location()?.url ?? '?'}`);
      });

      await seed(page);
      await page.goto(route, { waitUntil: 'load' });
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1500); // let lazy data fetches + effects settle

      expect(jsErrors, `uncaught JS exception(s) on ${route}:\n${jsErrors.join('\n')}`).toEqual([]);
      expect(badConsole, `non-benign console error(s) on ${route}:\n${badConsole.join('\n')}`).toEqual([]);
    });
  }
});
