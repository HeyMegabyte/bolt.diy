/**
 * @fileoverview Authenticated Playwright journey spec for /admin/system-services.
 *
 * Safety: ALL POST/PATCH/DELETE calls to /api/ paths are intercepted and stubbed.
 * No production data is mutated.
 *
 * Coverage:
 *  1. Page renders with REAL content (not skeleton) after auth stubs settle.
 *  2. Counts strip is visible.
 *  3. Service list renders ≥ 3 entries from the stub registry.
 *  4. A service card with a known id is present containing its domain.
 *  5. axe passes at 1280 and 375 viewports.
 *  6. Console is error-free.
 */

import { test, expect } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';
const TEST_EMAIL = 'brian@megabyte.space';

// ---------------------------------------------------------------------------
// Realistic stub data matching PlatformService interface
// ---------------------------------------------------------------------------
const STUB_SERVICES = [
  {
    id: 'listmonk',
    name: 'Listmonk',
    domain: 'mail.projectsites.dev',
    category: 'email',
    runtime: 'CF Container',
    status: 'production',
    access: 'internal',
    datastore: ['neon'],
    notes: 'Newsletter delivery engine',
  },
  {
    id: 'twenty-crm',
    name: 'Twenty CRM',
    domain: 'crm.megabyte.space',
    category: 'crm',
    runtime: 'CF Container',
    status: 'production',
    access: 'internal',
    datastore: ['neon', 'redis'],
    notes: 'CRM with custom fields for leads',
  },
  {
    id: 'plane',
    name: 'Plane',
    domain: 'pm.megabyte.space',
    category: 'project-management',
    runtime: 'CF Container',
    status: 'production',
    access: 'internal',
    datastore: ['neon', 'redis', 'r2'],
    notes: 'Linear-alternative for task tracking',
  },
  {
    id: 'inngest',
    name: 'Inngest',
    domain: 'events.projectsites.dev',
    category: 'workflow',
    runtime: 'CF Container',
    status: 'integrated',
    access: 'internal',
    datastore: ['sqlite'],
    notes: 'Durable event-driven workflows',
  },
  {
    id: 'langflow',
    name: 'Langflow',
    domain: 'llm.megabyte.space',
    category: 'ai',
    runtime: 'CF Container',
    status: 'integrated',
    access: 'internal',
    notes: 'Visual AI workflow builder',
  },
];

const STUB_COUNTS: Record<string, number> = {
  production: 3,
  integrated: 2,
  scaffolded: 0,
  planned: 0,
  deprecated: 0,
  removed: 0,
};

async function signInAsAdmin(page: any): Promise<void> {
  // LAST-RESORT /api catch-all — registered FIRST = matched LAST (reverse
  // registration order). Unstubbed /api requests (audit/rows, inbox/tasks, …)
  // must NEVER reach prod: with a fake bearer they 401 and ApiService clears
  // the session -> /signin bounce mid-test.
  await page.route('**/api/**', async (route: any) => {
    const m = route.request().method();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: m === 'GET' ? '{"data":[]}' : '{"ok":true}',
    });
  });

  await page.context().addInitScript(
    ({ t, id }: { t: string; id: string }) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: t, identifier: id, createdAt: Date.now() }),
      );
    },
    { t: 'e2e-stub-session-token', id: TEST_EMAIL },
  );

  await page.route('**/api/auth/me', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user_id: 'e2e-sysvc',
          email: TEST_EMAIL,
          name: 'E2E Operator',
          org_id: 'e2e-org',
          is_super_admin: true,
        },
      }),
    });
  });

  // glob-ok: query-suffix only — /api/super-admin/services has no subpaths
  await page.route('**/api/super-admin/services**', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ services: STUB_SERVICES, counts: STUB_COUNTS }),
    });
  });

  // glob-ok: query-suffix only — sites LIST; /api/sites/:id/* falls to catch-all
  await page.route('**/api/sites**', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'e2e-site-001',
            slug: 'e2e-site-001',
            business_name: 'E2E Test Business',
            status: 'published',
            org_id: 'e2e-org',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-07-01T00:00:00Z',
          },
        ],
        meta: { total: 1 },
      }),
    });
  });
  await page.route('**/api/billing/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // feature-flags is PUBLIC anonymous-safe — hit REAL prod so gated sections
  // render true prod state (hardcoded flags:{} fakes "not enabled" notices).
  await page.route('**/api/feature-flags**', (route: any) => route.continue());
  // Mid-token ** can't cross '/' — twin covers /api/feature-flags/:key reads
  await page.route('**/api/feature-flags/**', (route: any) => route.continue());
  await page.route('**/api/admin/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/analytics/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Safety: stub ALL POST/PATCH/DELETE mutations — never mutate prod
  await page.route('**', async (route: any) => {
    if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
      const url: string = route.request().url();
      if (url.includes('/api/')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
    }
    await route.fallback();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function goToSystemServices(page: any): Promise<void> {
  await page.goto(`${PROD_URL}/admin/system-services`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.use({ serviceWorkers: 'block' });

test.describe('Admin — System Services journey', () => {
  test('1 — shell renders + section visible (not skeleton) at 1280px', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToSystemServices(page);

    const section = page.getByTestId('system-services');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Skeleton must be gone
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 10_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-system-services/01-section-visible.png',
      fullPage: false,
    });
  });

  test('2 — counts strip is visible with production count', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToSystemServices(page);

    await expect(page.getByTestId('system-services')).toBeVisible({ timeout: 15_000 });

    const counts = page.getByTestId('system-services-counts');
    await expect(counts).toBeVisible({ timeout: 10_000 });
    // production=3 must appear somewhere in the counts strip
    await expect(counts).toContainText('3', { timeout: 5_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-system-services/02-counts-strip.png',
      fullPage: false,
    });
  });

  test('3 — service list renders ≥ 3 service cards from stub registry', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToSystemServices(page);

    await expect(page.getByTestId('system-services')).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId('service-listmonk')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('service-twenty-crm')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('service-plane')).toBeVisible({ timeout: 5_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-system-services/03-service-cards.png',
      fullPage: true,
    });
  });

  test('4 — service card with domain renders domain text', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToSystemServices(page);

    await expect(page.getByTestId('service-listmonk')).toBeVisible({ timeout: 15_000 });

    const listmonkCard = page.getByTestId('service-listmonk');
    await expect(listmonkCard).toContainText('mail.projectsites.dev', { timeout: 5_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-system-services/04-domain-text.png',
      fullPage: false,
    });
  });

  test('5 — axe clean at 1280 and 375 viewports', async ({ page }) => {
    await signInAsAdmin(page);

    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
      await goToSystemServices(page);
      await expect(page.getByTestId('system-services')).toBeVisible({ timeout: 15_000 });

      await checkA11y(page, `system-services-${width}px`);

      await page.screenshot({
        path: `e2e/screenshots/admin-system-services/05-a11y-${width}.png`,
        fullPage: false,
      });
    }
  });

  test('6 — console is error-free', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${PROD_URL}/admin/system-services`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('system-services')).toBeVisible({ timeout: 15_000 });

    const realErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('posthog') &&
        !e.includes('sentry') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(realErrors, `Console errors:\n${realErrors.join('\n')}`).toEqual([]);
  });
});
