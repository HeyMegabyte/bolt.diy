/**
 * @fileoverview E2E — Settings > AI Env Vars manager (TDD-RED)
 *
 * Flow: homepage → Admin → Settings → AI Env Vars tab →
 *       Add Variable → fill KEY + VALUE → save →
 *       assert row with masked value → delete → row gone.
 *
 * Screenshots in e2e/screenshots/env-vars-manager/.
 */

import { test, expect } from './fixtures.js';
import type { Page, Route } from '@playwright/test';

const BREAKPOINTS = [
  { width: 375,  height: 812  },
  { width: 390,  height: 844  },
  { width: 768,  height: 1024 },
  { width: 1024, height: 768  },
  { width: 1280, height: 800  },
  { width: 1920, height: 1080 },
];

interface EnvVar {
  id: string;
  key: string;
  masked_value: string;
  created_at: string;
}

let envVarStore: EnvVar[] = [];

async function stubAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ps_session',
      JSON.stringify({ token: 'e2e-envvars-token', email: 'test@megabyte.space' }),
    );
  });

  await page.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { user_id: 'u-ev', org_id: 'org-ev', email: 'test@megabyte.space' },
      }),
    });
  });

  await page.route('**/api/sites', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/api/billing/**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { plan: 'pro', status: 'active' } }),
    });
  });
}

async function stubEnvVarsApi(page: Page): Promise<void> {
  envVarStore = []; // reset per-test

  // GET env vars
  await page.route('**/api/env-vars**', async (route: Route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: envVarStore }),
      });
      return;
    }

    if (method === 'POST') {
      const body = await route.request().postDataJSON() as { key?: string; value?: string };
      const key = body.key ?? 'UNKNOWN';
      const val = body.value ?? '';
      const masked = `${'•'.repeat(Math.max(0, val.length - 4))}${val.slice(-4)}`;
      const newVar: EnvVar = {
        id: `ev-${Date.now()}`,
        key,
        masked_value: masked,
        created_at: new Date().toISOString(),
      };
      envVarStore.push(newVar);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: newVar }),
      });
      return;
    }

    await route.fallback();
  });

  // DELETE env var by id
  await page.route('**/api/env-vars/**', async (route: Route) => {
    const method = route.request().method();
    if (method !== 'DELETE') return route.fallback();

    const url = route.request().url();
    const id = url.split('/').pop() ?? '';
    envVarStore = envVarStore.filter((v) => v.id !== id);
    await route.fulfill({ status: 204 });
  });
}

async function navigateToEnvVars(page: Page): Promise<void> {
  await page.goto('/');
  await page.click('[data-testid="nav-admin"], a[href*="/admin"], text=Admin');
  await page.waitForURL(/\/admin/);

  // Click Settings in sidebar
  await page.click('[data-testid="sidebar-settings"], [href*="settings"], text=Settings');
  await page.waitForURL(/\/admin\/settings/);

  // Click "AI Env Vars" tab
  const envTab = page.locator(
    '[data-testid="settings-tab-env-vars"], [role="tab"]:has-text("Env Vars"), ' +
    '[role="tab"]:has-text("AI Env"), text=AI Env Vars, text=Env Variables',
  );
  await expect(envTab).toBeVisible({ timeout: 8_000 });
  await envTab.click();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Settings — AI Env Vars manager', () => {
  test('Add Variable → row appears with masked value (last 4 chars visible)', async ({ page }) => {
    await stubAuth(page);
    await stubEnvVarsApi(page);

    await navigateToEnvVars(page);
    await page.screenshot({ path: 'e2e/screenshots/env-vars-manager/01-tab.png', fullPage: false });

    // Click Add Variable
    const addBtn = page.locator(
      '[data-testid="env-var-add-btn"], button:has-text("Add Variable"), button:has-text("Add Env Var")',
    ).first();
    await expect(addBtn).toBeVisible({ timeout: 8_000 });
    await addBtn.click();

    // Fill KEY field
    const keyInput = page.locator(
      '[data-testid="env-var-key-input"], input[placeholder*="KEY" i], input[name="key"]',
    ).first();
    await expect(keyInput).toBeVisible({ timeout: 5_000 });
    await keyInput.fill('TEST_API_KEY');

    // Fill VALUE field
    const valueInput = page.locator(
      '[data-testid="env-var-value-input"], input[placeholder*="value" i], input[name="value"], input[type="password"]',
    ).first();
    await expect(valueInput).toBeVisible({ timeout: 5_000 });
    await valueInput.fill('sk-test-abc123');

    await page.screenshot({ path: 'e2e/screenshots/env-vars-manager/02-filled.png', fullPage: false });

    // Click Save / Add
    const saveBtn = page.locator(
      '[data-testid="env-var-save-btn"], button:has-text("Save"), button:has-text("Add"), button[type="submit"]',
    ).last();
    await saveBtn.click();

    // Row with masked value should appear
    const varRow = page.locator(
      '[data-testid="env-var-row"], .env-var-row, tr:has-text("TEST_API_KEY")',
    );
    await expect(varRow.first()).toBeVisible({ timeout: 8_000 });

    // Masked value: last 4 chars of 'sk-test-abc123' = 'c123'
    await expect(varRow.first()).toContainText('c123');

    await page.screenshot({ path: 'e2e/screenshots/env-vars-manager/03-row-added.png', fullPage: false });
  });

  test('Delete row → row disappears optimistically', async ({ page }) => {
    await stubAuth(page);
    await stubEnvVarsApi(page);

    // Pre-seed one var by calling the route directly after setup
    // We'll add it via the UI so the flow is end-to-end
    await navigateToEnvVars(page);

    // Add first
    const addBtn = page.locator(
      '[data-testid="env-var-add-btn"], button:has-text("Add Variable")',
    ).first();
    await expect(addBtn).toBeVisible({ timeout: 8_000 });
    await addBtn.click();

    const keyInput = page.locator(
      '[data-testid="env-var-key-input"], input[placeholder*="KEY" i], input[name="key"]',
    ).first();
    await keyInput.fill('DELETE_ME_KEY');

    const valueInput = page.locator(
      '[data-testid="env-var-value-input"], input[placeholder*="value" i], input[name="value"]',
    ).first();
    await valueInput.fill('xyz-9999');

    const saveBtn = page.locator(
      '[data-testid="env-var-save-btn"], button:has-text("Save"), button:has-text("Add"), button[type="submit"]',
    ).last();
    await saveBtn.click();

    const varRow = page.locator(
      '[data-testid="env-var-row"], .env-var-row, tr:has-text("DELETE_ME_KEY")',
    );
    await expect(varRow.first()).toBeVisible({ timeout: 8_000 });

    // Now delete it
    const deleteBtn = varRow.first().locator(
      '[data-testid="env-var-delete-btn"], button:has-text("Delete"), button[aria-label*="delete" i]',
    );
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Confirm deletion if modal appears
    const confirmBtn = page.locator(
      '[data-testid="confirm-delete"], button:has-text("Confirm"), button:has-text("Yes, delete")',
    );
    if (await confirmBtn.count() > 0) {
      await confirmBtn.first().click();
    }

    // Row should be gone
    await expect(varRow).toHaveCount(0, { timeout: 8_000 });

    await page.screenshot({ path: 'e2e/screenshots/env-vars-manager/04-deleted.png', fullPage: false });
  });

  test('masked value never reveals the full secret — only last 4 chars visible', async ({ page }) => {
    await stubAuth(page);
    await stubEnvVarsApi(page);

    await navigateToEnvVars(page);

    const addBtn = page.locator(
      '[data-testid="env-var-add-btn"], button:has-text("Add Variable")',
    ).first();
    await expect(addBtn).toBeVisible({ timeout: 8_000 });
    await addBtn.click();

    const keyInput = page.locator(
      '[data-testid="env-var-key-input"], input[placeholder*="KEY" i], input[name="key"]',
    ).first();
    await keyInput.fill('SECRET_KEY');

    const valueInput = page.locator(
      '[data-testid="env-var-value-input"], input[placeholder*="value" i], input[name="value"]',
    ).first();
    await valueInput.fill('sk-test-abc123');

    const saveBtn = page.locator(
      '[data-testid="env-var-save-btn"], button:has-text("Save"), button:has-text("Add"), button[type="submit"]',
    ).last();
    await saveBtn.click();

    const varRow = page.locator(
      '[data-testid="env-var-row"], .env-var-row',
    );
    await expect(varRow.first()).toBeVisible({ timeout: 8_000 });

    const rowText = await varRow.first().textContent() ?? '';
    // Full value must NOT be visible
    expect(rowText).not.toContain('sk-test-abc123');
    // Last 4 chars must be visible
    expect(rowText).toContain('c123');
  });

  // ─── Breakpoint smoke ───────────────────────────────────────────────────────

  for (const vp of BREAKPOINTS) {
    test(`Env Vars tab renders at ${vp.width}×${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await stubAuth(page);
      await stubEnvVarsApi(page);

      await navigateToEnvVars(page);

      await page.screenshot({
        path: `e2e/screenshots/env-vars-manager/bp-${vp.width}.png`,
        fullPage: false,
      });

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(vp.width + 2);
    });
  }
});
