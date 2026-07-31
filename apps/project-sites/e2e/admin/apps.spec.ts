/**
 * ADMIN-19 — /admin/apps/:id app detail + deploy panel (catalog card click-through)
 * ADMIN-20 — /admin/apps/instances installed-instance list + deploy round-trip
 *
 * MODERNIZED 2026-07-31 (residual-admin triage). The old spec targeted the
 * RETIRED routes `/admin/apps-detail/:id` and `/admin/apps-instances`; the
 * live routes are `apps/:id` + `apps/instances` (+ `apps/instances/:id`).
 * The `/admin/apps` CATALOG itself is covered by admin-apps-journey.spec.ts —
 * what that journey does NOT cover is the detail deploy panel and the
 * instances surface, which this spec now owns.
 *
 * Anchor app: `umami` — `supported: true` in apps-catalog.data.ts and all its
 * env vars are `auto` (platform-injected), so `missingRequiredEnv` is empty
 * and deploy-readiness reduces to subdomain validity — deterministic without
 * env-form interaction.
 *
 * Contracts under test (hard asserts — stubs make every state deterministic):
 *  1. Catalog card (apps-card-umami) → SPA-navigates to /admin/apps/umami →
 *     deploy CTA + subdomain input render.
 *  2. Value-domain sweep on the subdomain input (empty / whitespace / short /
 *     long / uppercase+symbols / XSS / SQLish / unicode / dash-edges / valid)
 *     drives the exact inline error copy + CTA disabled state.
 *  3. Deploy → ConfirmDialog (confirm-accept) → POST /api/apps/instances →
 *     router lands on the instance boot-progress detail.
 *  4. /admin/apps/instances renders stubbed instance rows.
 *
 * House pattern: authedPage fixture; test-body stubs registered AFTER the
 * helper (reverse-registration wins); `?**` glob twins on every route.
 */

import { test, expect } from '../fixtures.js';
import type { Page, Route } from '@playwright/test';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev';

const INSTANCE = {
  id: 'inst-e2e-1',
  app_id: 'umami',
  subdomain: 'my-umami-e2e',
  hostname: 'my-umami-e2e-app.projectsites.dev',
  status: 'running',
  created_at: '2026-07-01T00:00:00Z',
  last_activity_at: '2026-07-30T00:00:00Z',
  env_keys: [],
  last_error: null,
};

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('posthog') &&
      !e.includes('sentry') &&
      !e.includes('net::ERR_BLOCKED_BY_CLIENT') &&
      !e.toLowerCase().includes('failed to load resource') &&
      !e.includes('Http failure') &&
      !e.includes('ChunkLoadError') &&
      !e.includes('Loading chunk'),
  );
}

/** Stubs the instances API family. Registered in the test body → beats the helper. */
async function stubInstances(page: Page): Promise<void> {
  const list = async (route: Route): Promise<void> => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ instance_id: INSTANCE.id }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ instances: [INSTANCE] }),
    });
  };
  const detail = async (route: Route): Promise<void> => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ instance: INSTANCE }),
    });
  };
  const logs = async (route: Route): Promise<void> => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lines: [] }),
    });
  };
  await page.route('**/api/apps/instances', list);
  await page.route('**/api/apps/instances?**', list);
  await page.route(`**/api/apps/instances/${INSTANCE.id}`, detail);
  await page.route(`**/api/apps/instances/${INSTANCE.id}?**`, detail);
  await page.route(`**/api/apps/instances/${INSTANCE.id}/logs`, logs);
  await page.route(`**/api/apps/instances/${INSTANCE.id}/logs?**`, logs);
}

test.describe('ADMIN-19 — /admin/apps/:id detail + deploy panel', () => {
  test('catalog card SPA-navigates to the umami detail with deploy CTA', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    await stubInstances(page);

    await page.goto(`${BASE}/admin/apps`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const card = page.locator('[data-testid="apps-card-umami"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.click();
    await page.waitForURL(/\/admin\/apps\/umami/, { timeout: 10_000 });

    // Detail renders the catalog entry (local data — no fetch involved).
    await expect(
      page.locator('h2').filter({ hasText: /^Umami$/ }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="apps-deploy-cta"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="apps-deploy-subdomain"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="apps-feature-list"]')).toBeVisible({
      timeout: 10_000,
    });

    await page.screenshot({ path: 'e2e/screenshots/admin-apps/01-detail.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });

  test('value-domain sweep on the subdomain input drives errors + CTA gating', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    await stubInstances(page);
    page.on('dialog', (d) => {
      throw new Error(`Unexpected dialog from subdomain value: ${d.message()}`);
    });

    await page.goto(`${BASE}/admin/apps/umami`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const input = page.locator('[data-testid="apps-deploy-subdomain"]');
    const cta = page.locator('[data-testid="apps-deploy-cta"]');
    await expect(input).toBeVisible({ timeout: 20_000 });

    // Each case: [value, expected inline error fragment]. Umami's required env
    // vars are all auto-injected, so the CTA gates on subdomain validity alone.
    const invalidCases: Array<[string, RegExp]> = [
      ['ab', /Min 3 characters/i], // too short
      ['a'.repeat(41), /Max 40 characters/i], // too long
      ['Bad_Name!', /Lowercase letters, digits, and dashes only/i], // case+symbols
      ['<script>alert(1)</script>', /Lowercase letters, digits, and dashes only/i], // XSS
      ["a' or 1=1--", /Lowercase letters, digits, and dashes only/i], // SQL-ish
      ['café-☕', /Lowercase letters, digits, and dashes only/i], // unicode+emoji
      ['-abc-', /Cannot start or end with a dash/i], // boundary dashes
    ];

    for (const [value, errorRe] of invalidCases) {
      await input.fill(value);
      await input.blur();
      await expect(page.locator('.form-help--err').first()).toHaveText(errorRe, {
        timeout: 5_000,
      });
      await expect(cta).toBeDisabled();
    }

    // Empty + whitespace → required error.
    await input.fill('   ');
    await input.blur();
    await expect(page.locator('.form-help--err').first()).toHaveText(/Subdomain is required/i, {
      timeout: 5_000,
    });
    await expect(cta).toBeDisabled();

    // Valid value → error clears, CTA arms.
    await input.fill('my-umami-e2e');
    await input.blur();
    await expect(page.locator('.form-help--err')).toHaveCount(0, { timeout: 5_000 });
    await expect(cta).toBeEnabled({ timeout: 5_000 });

    await page.screenshot({ path: 'e2e/screenshots/admin-apps/02-value-domains.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });

  test('deploy confirms, POSTs /api/apps/instances, and lands on boot progress', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    await stubInstances(page);

    await page.goto(`${BASE}/admin/apps/umami`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const input = page.locator('[data-testid="apps-deploy-subdomain"]');
    await expect(input).toBeVisible({ timeout: 20_000 });
    await input.fill('my-umami-e2e');
    await input.blur();

    const cta = page.locator('[data-testid="apps-deploy-cta"]');
    await expect(cta).toBeEnabled({ timeout: 5_000 });

    const postPromise = page.waitForRequest(
      (req) => req.url().includes('/api/apps/instances') && req.method() === 'POST',
      { timeout: 15_000 },
    );

    await cta.click();

    // A4 guard: billable-infra confirm dialog must appear; accept it.
    const confirmBtn = page.locator('[data-testid="confirm-accept"]');
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
    await confirmBtn.click();

    const post = await postPromise;
    const body = post.postDataJSON() as { app_id: string; subdomain: string };
    expect(body.app_id).toBe('umami');
    expect(body.subdomain).toBe('my-umami-e2e');

    // Success routes to the instance boot-progress detail.
    await page.waitForURL(new RegExp(`/admin/apps/instances/${INSTANCE.id}`), {
      timeout: 15_000,
    });

    await page.screenshot({ path: 'e2e/screenshots/admin-apps/03-deployed.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });
});

test.describe('ADMIN-20 — /admin/apps/instances lists installed instances', () => {
  test('instances list renders the stubbed row via the My-instances link', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    await stubInstances(page);

    // Enter via the catalog's "My instances" affordance (real-user nav).
    await page.goto(`${BASE}/admin/apps`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const myInstances = page.getByRole('link', { name: /My instances/i }).first();
    await expect(myInstances).toBeVisible({ timeout: 20_000 });
    await myInstances.click();
    await page.waitForURL(/\/admin\/apps\/instances/, { timeout: 10_000 });

    // The stubbed instance row renders with its stable per-id testid.
    await expect(page.locator(`[data-testid="apps-instance-${INSTANCE.id}"]`)).toBeVisible({
      timeout: 15_000,
    });

    await page.screenshot({ path: 'e2e/screenshots/admin-apps/04-instances.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });
});
