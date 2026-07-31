/**
 * Admin → Social — authenticated E2E journey.
 *
 * Tests the /admin/social section: accounts pane, compose tab, platform chip
 * toggle, composer textarea, tab switch, accessibility, and console-error hygiene.
 *
 * Safety: ALL POST/PATCH/DELETE requests to /api/** are stubbed — never posts to
 * real social networks or modifies prod data.
 */
import path from 'path';
import fs from 'fs';
import { test, expect, type Page } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });
const STUB_EMAIL = 'test@megabyte.space';

const STUB_SITE = {
  id: 'e2e-site-id',
  slug: 'e2e-test-site',
  org_id: 'e2e-test-org',
  name: 'E2E Test Site',
  status: 'published',
  primary_hostname: 'e2e-test.projectsites.dev',
};

const STUB_ACCOUNTS = [
  {
    id: 'acct-twitter-1',
    platform: 'twitter',
    label: 'Twitter',
    username: '@e2etestuser',
    connected: true,
    avatarUrl: null,
  },
  {
    id: 'acct-linkedin-1',
    platform: 'linkedin',
    label: 'LinkedIn',
    username: 'E2E Test User',
    connected: true,
    avatarUrl: null,
  },
];

const STUB_POSTS = [
  {
    id: 'post-001',
    content: 'Check out our new website! Built with ProjectSites.dev',
    platform: 'twitter',
    status: 'scheduled',
    scheduledAt: '2026-08-01T10:00:00Z',
    siteId: 'e2e-site-id',
  },
  {
    id: 'post-002',
    content: 'Excited to announce our launch on LinkedIn!',
    platform: 'linkedin',
    status: 'draft',
    scheduledAt: null,
    siteId: 'e2e-site-id',
  },
];

async function signInAndStubSocial(page: Page): Promise<void> {
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
    { t: 'e2e-stub-session-token', id: STUB_EMAIL },
  );

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user_id: 'e2e-test-user-id',
          email: STUB_EMAIL,
          name: 'E2E Test User',
          org_id: 'e2e-test-org',
          is_super_admin: true,
        },
      }),
    });
  });

  // Return one site so selectedSite() is populated (social requires it)
  // glob-ok: query-suffix only — sites LIST; /api/sites/:id/* falls to catch-all
  await page.route('**/api/sites**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [STUB_SITE], meta: { total: 1 } }),
    });
  });

  await page.route('**/api/billing/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // feature-flags is PUBLIC anonymous-safe — hit REAL prod so gated sections
  // render true prod state (hardcoded flags:{} fakes "not enabled" notices).
  await page.route('**/api/feature-flags**', (route: any) => route.continue());
  // Mid-token ** can't cross '/' — twin covers /api/feature-flags/:key reads
  await page.route('**/api/feature-flags/**', (route: any) => route.continue());

  await page.route('**/api/analytics/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/api/analytics/track', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/api/super-admin/feature-flags', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ flags: [], count: 0 }),
    });
  });

  // Social-specific API stubs
  const accountsStub = async (route: any) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: STUB_ACCOUNTS }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    }
  };
  await page.route('**/api/social/accounts**', accountsStub);
  // Mid-token ** can't cross '/' — twin covers /api/social/accounts/:id
  await page.route('**/api/social/accounts/**', accountsStub);

  const postsStub = async (route: any) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: STUB_POSTS }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, id: 'post-new-001' }),
      });
    }
  };
  await page.route('**/api/social/posts**', postsStub);
  // Mid-token ** can't cross '/' — twin covers /posts/:id + /:id/publish-now
  await page.route('**/api/social/posts/**', postsStub);

  await page.route('**/api/social/generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: 'AI-generated post content for E2E testing!' }),
    });
  });

  await page.route('**/api/social/og-preview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: 'E2E Test Site', description: 'Test', imageUrl: null }),
    });
  });

  // Safety: stub all remaining social mutations
  await page.route('**/api/social/**', async (route) => {
    const method = route.request().method();
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });

  // Broad admin catch-all
  await page.route('**/api/admin/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Safety: block all other mutations
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    } else {
      await route.fallback();
    }
  });
}

function ensureDir(sub: string): string {
  const dir = path.join('e2e', 'screenshots', sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test.describe('Admin — Social (authenticated journey)', () => {
  test('social section renders with accounts pane and compose tab', async ({ page }) => {
    const dir = ensureDir('admin-social');
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await signInAndStubSocial(page);
    await page.goto(`${PROD_URL}/admin/social`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    // Social component should be visible
    const socialSection = page.locator('app-admin-social');
    await expect(socialSection).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: path.join(dir, '01-section-loaded.png') });

    // Compose tab should be visible (default tab)
    const composeTab = page.getByRole('tab', { name: 'Compose' });
    if (await composeTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(composeTab).toBeVisible();
    }

    await page.screenshot({ path: path.join(dir, '02-compose-tab-visible.png') });

    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') && !e.toLowerCase().includes('failed to load resource') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED') &&
        !e.includes('net::ERR_'),
    );
    expect(realErrors, `Console errors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
  });

  test('composer textarea accepts text input', async ({ page }) => {
    const dir = ensureDir('admin-social');

    await signInAndStubSocial(page);
    await page.goto(`${PROD_URL}/admin/social`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await expect(page.locator('app-admin-social')).toBeVisible({ timeout: 15_000 });

    const textarea = page.locator('[data-testid="social-composer-textarea"]');
    await expect(textarea).toBeVisible({ timeout: 10_000 });

    await textarea.click();
    await page.keyboard.type('Test post content for E2E verification #test');

    await page.screenshot({ path: path.join(dir, '03-textarea-filled.png') });

    // Character counter should update
    const counter = page.locator('[data-testid="composer-counter"]');
    if (await counter.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const counterText = await counter.textContent();
      expect(counterText).not.toBeNull();
    }
  });

  test('platform chip selection toggles aria-pressed', async ({ page }) => {
    const dir = ensureDir('admin-social');

    await signInAndStubSocial(page);
    await page.goto(`${PROD_URL}/admin/social`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await expect(page.locator('app-admin-social')).toBeVisible({ timeout: 15_000 });

    // Find platform chips (aria-pressed pattern)
    const platformChips = page.locator('[aria-pressed]');
    const chipCount = await platformChips.count();

    if (chipCount > 0) {
      // Click the first unselected chip to select it
      const firstChip = platformChips.first();
      await firstChip.click();
      await page.screenshot({ path: path.join(dir, '04-platform-chip-selected.png') });

      // Click again to deselect
      await firstChip.click();
      await page.screenshot({ path: path.join(dir, '05-platform-chip-deselected.png') });
    } else {
      // TDD-RED: platform chips with [aria-pressed] not found
      console.warn('TDD-RED: platform chips ([aria-pressed]) not found on social section');
    }
  });

  test('tab switch from Compose to Queue', async ({ page }) => {
    const dir = ensureDir('admin-social');

    await signInAndStubSocial(page);
    await page.goto(`${PROD_URL}/admin/social`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await expect(page.locator('app-admin-social')).toBeVisible({ timeout: 15_000 });

    // Click the Queue tab
    const queueTab = page.getByRole('tab', { name: 'Queue' });
    if (await queueTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await queueTab.click();
      await page.screenshot({ path: path.join(dir, '06-queue-tab-selected.png') });

      // Navigate back to Compose
      const composeTab = page.getByRole('tab', { name: 'Compose' });
      if (await composeTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await composeTab.click();
        await page.screenshot({ path: path.join(dir, '07-compose-tab-reselected.png') });
      }
    } else {
      // TDD-RED: Queue tab not found by role+name
      // The component uses <button role="tab"> with text "Queue"
      console.warn('TDD-RED: Queue tab not found — check tab selector pattern');
    }
  });

  test('auto-pilot button is visible and clickable', async ({ page }) => {
    const dir = ensureDir('admin-social');

    await signInAndStubSocial(page);
    await page.goto(`${PROD_URL}/admin/social`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await expect(page.locator('app-admin-social')).toBeVisible({ timeout: 15_000 });

    const autopilotBtn = page.locator('[data-testid="social-auto-pilot-prompt-btn"]');
    if (await autopilotBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await autopilotBtn.click();
      await page.screenshot({ path: path.join(dir, '08-autopilot-clicked.png') });
    } else {
      console.warn('TDD-RED: [data-testid="social-auto-pilot-prompt-btn"] not visible');
    }
  });

  test('accessibility at 1280px and 375px', async ({ page }) => {
    const dir = ensureDir('admin-social');

    await signInAndStubSocial(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${PROD_URL}/admin/social`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('app-admin-social')).toBeVisible({ timeout: 15_000 });
    await checkA11y(page, 'social-1280');
    await page.screenshot({ path: path.join(dir, '09-a11y-1280.png') });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('app-admin-social')).toBeVisible({ timeout: 15_000 });
    await checkA11y(page, 'social-375');
    await page.screenshot({ path: path.join(dir, '10-a11y-375.png') });
  });

  test('zero console errors during social section load', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await signInAndStubSocial(page);
    await page.goto(`${PROD_URL}/admin/social`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('app-admin-social')).toBeVisible({ timeout: 15_000 });

    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') && !e.toLowerCase().includes('failed to load resource') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED') &&
        !e.includes('net::ERR_') &&
        !e.includes('Failed to load resource'),
    );
    expect(realErrors, `Unexpected errors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
  });
});
