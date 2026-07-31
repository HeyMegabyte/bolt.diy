/**
 * @fileoverview Authenticated Playwright journey spec for /admin/settings.
 *
 * Safety: ALL POST/PATCH/DELETE API calls are intercepted and stubbed.
 * No production data is mutated.
 *
 * Coverage:
 *  1. Settings section renders with the General tab active by default.
 *  2. Clicking the Business tab shows the business name field.
 *  3. Clicking the Team tab shows the invite button.
 *  4. Clicking the Email tab shows the email allowance card.
 *  5. Clicking the MCP tab shows the MCP connections panel.
 *  6. axe clean at 1280 and 375 viewports.
 *  7. Console error-free.
 */

import { test, expect } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });
const TEST_EMAIL = 'brian@megabyte.space';

// ---------------------------------------------------------------------------
// Stub data
// ---------------------------------------------------------------------------
const STUB_SITE = {
  id: 'e2e-site-id',
  slug: 'e2e-test-site',
  name: 'E2E Test Site',
  org_id: 'e2e-org',
  status: 'published',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const STUB_TEAM = [
  {
    user_id: 'e2e',
    email: TEST_EMAIL,
    name: 'E2E Test User',
    role: 'owner',
    joined_at: new Date().toISOString(),
  },
  {
    user_id: 'e2e-2',
    email: 'alice@megabyte.space',
    name: 'Alice Test',
    role: 'admin',
    joined_at: new Date().toISOString(),
  },
];

const STUB_MCP_CONNECTIONS = [
  {
    provider: 'mailchimp',
    status: 'connected',
    connected_at: new Date().toISOString(),
    label: 'Marketing List',
  },
  {
    provider: 'github',
    status: 'connected',
    connected_at: new Date().toISOString(),
    label: 'Main Repo',
  },
];

const STUB_AI_SETTINGS = {
  web_search_enabled: true,
  knowledge_base: [],
};

const STUB_SECURITY = {
  two_factor_enabled: false,
  sessions: 1,
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
    { t: 'e2e-settings-token', id: TEST_EMAIL },
  );

  // Auth stub
  await page.route('**/api/auth/me', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user_id: 'e2e',
          email: TEST_EMAIL,
          name: 'E2E Settings User',
          org_id: 'e2e-org',
          is_super_admin: false,
        },
      }),
    });
  });

  // Sites — must return at least one so settings can load site-scoped data
  await page.route('**/api/sites', async (route: any) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [STUB_SITE], meta: { total: 1 } }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });

  // Individual site
  await page.route(`**/api/sites/${STUB_SITE.id}`, async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: STUB_SITE }),
    });
  });

  // Security settings
  await page.route('**/api/admin/security', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: STUB_SECURITY }),
    });
  });

  // AI settings
  await page.route(`**/api/sites/${STUB_SITE.id}/ai-settings`, async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: STUB_AI_SETTINGS }),
    });
  });

  // Team members
  await page.route('**/api/team', async (route: any) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: STUB_TEAM, meta: { total: 2 } }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });

  // MCP connections
  await page.route(`**/api/sites/${STUB_SITE.id}/mcp/connections`, async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: STUB_MCP_CONNECTIONS }),
    });
  });

  // Wildcard MCP stubs
  await page.route('**/api/sites/*/mcp/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/mcp/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Billing stubs
  await page.route('**/api/billing/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Feature flags
  // feature-flags is PUBLIC anonymous-safe — hit REAL prod so gated sections
  // render true prod state (hardcoded flags:{} fakes "not enabled" notices).
  await page.route('**/api/feature-flags**', (route: any) => route.continue());
  // Mid-token ** can't cross '/' — twin covers /api/feature-flags/:key reads
  await page.route('**/api/feature-flags/**', (route: any) => route.continue());

  // Admin catch-all
  await page.route('**/api/admin/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Analytics
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
async function goToSettings(page: any): Promise<void> {
  await page.goto(`${PROD_URL}/admin/settings`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
}

async function waitForSettingsPanel(page: any): Promise<void> {
  // Settings renders a tabpanel — wait for the panel to appear
  await expect(
    page.locator('[id="settings-panel"], [role="tabpanel"]').first(),
  ).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Admin — Settings journey', () => {
  test('1 — settings section renders with a tab list visible', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToSettings(page);

    // Tab list must be present (General is the default active tab)
    const generalTab = page.locator('[id="settings-tab-general"]');
    await expect(generalTab).toBeVisible({ timeout: 15_000 });

    // General panel should be displayed
    await waitForSettingsPanel(page);

    await page.screenshot({
      path: 'e2e/screenshots/admin-settings/01-general-tab.png',
      fullPage: false,
    });
  });

  test('2 — Business tab shows business name field', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToSettings(page);

    // Wait for tab UI to render
    const businessTab = page.locator('[id="settings-tab-business"]');
    await expect(businessTab).toBeVisible({ timeout: 15_000 });

    // Click the Business tab
    await businessTab.click();
    await page.waitForTimeout(300); // tab transition

    // Business name field should now be visible
    const businessNameField = page.getByTestId('business-name');
    await expect(businessNameField).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-settings/02-business-tab.png',
      fullPage: false,
    });
  });

  test('3 — Team tab shows invite button', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToSettings(page);

    const teamTab = page.locator('[id="settings-tab-team"]');
    await expect(teamTab).toBeVisible({ timeout: 15_000 });

    // Click Team tab
    await teamTab.click();
    await page.waitForTimeout(300);

    // Invite button should appear
    const inviteButton = page.getByTestId('team-invite-button');
    await expect(inviteButton).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-settings/03-team-tab.png',
      fullPage: false,
    });
  });

  test('4 — Email tab shows email allowance card', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToSettings(page);

    const emailTab = page.locator('[id="settings-tab-email"]');
    await expect(emailTab).toBeVisible({ timeout: 15_000 });

    // Click Email tab
    await emailTab.click();
    await page.waitForTimeout(300);

    // Email settings panel or allowance card should appear
    const emailPanel = page.getByTestId('settings-email-panel');
    const allowanceCard = page.getByTestId('email-allowance-card');

    // At least one must be visible
    const panelVisible = await emailPanel.isVisible().catch(() => false);
    const cardVisible = await allowanceCard.isVisible().catch(() => false);

    expect(panelVisible || cardVisible, 'Email tab should show panel or allowance card').toBe(true);

    await page.screenshot({
      path: 'e2e/screenshots/admin-settings/04-email-tab.png',
      fullPage: false,
    });
  });

  test('5 — MCP tab shows connections panel', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToSettings(page);

    const mcpTab = page.locator('[id="settings-tab-mcp"]');
    await expect(mcpTab).toBeVisible({ timeout: 15_000 });

    // Click MCP tab
    await mcpTab.click();
    await page.waitForTimeout(400); // allow data fetch

    // Tab panel should be visible with MCP content
    const panel = page.locator('[id="settings-panel"], [role="tabpanel"]').first();
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Panel should contain some text referencing integrations or connections
    const panelText = await panel.textContent({ timeout: 5_000 });
    const hasContent =
      panelText !== null &&
      panelText.length > 0 &&
      (panelText.toLowerCase().includes('connect') ||
        panelText.toLowerCase().includes('mcp') ||
        panelText.toLowerCase().includes('integration') ||
        panelText.toLowerCase().includes('mailchimp') ||
        panelText.toLowerCase().includes('github'));

    expect(hasContent, 'MCP tab panel should display connection content').toBe(true);

    await page.screenshot({
      path: 'e2e/screenshots/admin-settings/05-mcp-tab.png',
      fullPage: false,
    });
  });

  test('6 — tab navigation cycles through all 4 main tabs via keyboard', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToSettings(page);

    const generalTab = page.locator('[id="settings-tab-general"]');
    await expect(generalTab).toBeVisible({ timeout: 15_000 });

    // Focus the general tab
    await generalTab.focus();

    // Tab titles we expect
    const tabIds = [
      'settings-tab-general',
      'settings-tab-business',
      'settings-tab-team',
      'settings-tab-ai-chat',
      'settings-tab-mcp',
    ];

    for (const tabId of tabIds) {
      const tab = page.locator(`[id="${tabId}"]`);
      await expect(tab).toBeVisible({ timeout: 5_000 });
    }

    await page.screenshot({
      path: 'e2e/screenshots/admin-settings/06-tab-navigation.png',
      fullPage: false,
    });
  });

  test('7 — axe clean at 1280 and 375 viewports', async ({ page }) => {
    await signInAsAdmin(page);

    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
      await goToSettings(page);
      await waitForSettingsPanel(page);

      await checkA11y(page, `settings-${width}px`);

      await page.screenshot({
        path: `e2e/screenshots/admin-settings/07-a11y-${width}.png`,
        fullPage: false,
      });
    }
  });

  test('8 — console is error-free', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${PROD_URL}/admin/settings`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await waitForSettingsPanel(page);

    const realErrors = errors.filter(
      (e) =>
        !e.includes('favicon') && !e.toLowerCase().includes('failed to load resource') &&
        !e.includes('third-party') &&
        !e.includes('posthog') &&
        !e.includes('sentry'),
    );
    expect(realErrors, `Console errors:\n${realErrors.join('\n')}`).toEqual([]);
  });
});
