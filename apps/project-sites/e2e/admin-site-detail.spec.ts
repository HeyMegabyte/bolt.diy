/**
 * Site detail routes — auth-gate verification for per-site admin surfaces.
 *
 * Covers: /admin/sites/:id (detail tabs), /admin/sites/:id/branches,
 * /admin/sites/:id/mcp-server, /admin/sites/:id/copilot, /admin/sites/:id/dna.
 * All should redirect to sign-in when unauthenticated.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

const SITE_DETAIL_ROUTES = [
  '/admin/sites/test-site',
  '/admin/sites/test-site/branches',
  '/admin/sites/test-site/mcp-server',
  '/admin/sites/test-site/copilot',
  '/admin/sites/test-site/dna',
] as const;

test.describe('Site Detail Routes — Auth Gate', () => {
  for (const path of SITE_DETAIL_ROUTES) {
    test(`${path} redirects to sign-in when unauthenticated`, async ({ page }) => {
      await page.goto(`${PROD_URL}${path}`);
      await page.waitForURL('**/signin**', { timeout: 10000 });
      await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
    });
  }
});

test.describe('Subdomain Landing Pages', () => {
  const subdomains = [
    { host: 'https://analytics.projectsites.dev', name: 'Analytics (PostHog)' },
    { host: 'https://logs.projectsites.dev', name: 'Logs (Axiom)' },
    { host: 'https://webhooks.projectsites.dev', name: 'Webhooks (Hookdeck)' },
    { host: 'https://links.projectsites.dev', name: 'Links (Dub)' },
    { host: 'https://billing.projectsites.dev', name: 'Billing (Stripe)' },
    { host: 'https://browser.projectsites.dev', name: 'Browser (CF Browser Rendering)' },
    { host: 'https://llm.projectsites.dev', name: 'LLM (LiteLLM + AI Gateway)' },
  ];

  for (const { host, name } of subdomains) {
    test(`${name} landing page is reachable`, async ({ request }) => {
      const res = await request.get(host);
      // May be 200 (landing page), 301/302 (redirect to SaaS login), or 401/403 (auth-gated)
      expect([200, 301, 302, 401, 403]).toContain(res.status());
    });
  }
});
