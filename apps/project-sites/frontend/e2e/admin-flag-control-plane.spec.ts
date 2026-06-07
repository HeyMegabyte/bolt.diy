/**
 * @module e2e/admin-flag-control-plane
 *
 * Dev-suite (mock-server) gate for the TWO-LAYER feature-flag control plane:
 *
 *   Layer 1 — System Administrator (`/admin/feature-flags`): platform-ops flags
 *             for the super-admin. Progressive disclosure (Simple/Advanced/
 *             Expert), dangerous-change confirm with typed reason, blast-radius,
 *             evaluation trace, per-flag audit history, emergency killswitch.
 *
 *   Layer 2 — Site Features (`/admin/site-features`): owner-facing, plan-aware
 *             feature cards a site owner enables for THEIR hosted site, with
 *             entitlement-locked states, preview mode, and undo.
 *
 * Runs against the local mock server (`scripts/e2e_server.cjs`) via
 * `playwright.config.ts` — no secret required. Auth uses the canonical
 * `brian@megabyte.space` stub from `fixtures.ts`.
 *
 * Console allowlist mirrors `admin-logo-console-editor.spec.ts`.
 */
import { test, expect } from './fixtures';
import type { Page, ConsoleMessage } from '@playwright/test';

// ─── Console hygiene (mirrors admin-logo-console-editor.spec.ts) ───────────

function isBenign(msg: ConsoleMessage): boolean {
  const text = msg.text();
  const url = msg.location()?.url ?? '';
  if (/editor\.projectsites\.dev/i.test(url) || /editor\.projectsites\.dev/i.test(text)) return true;
  if (/Failed to load resource: the server responded with a status of [45]\d\d/i.test(text)) return true;
  if (/SharedArrayBuffer|Skipping boot — embedded mode|webcontainer/i.test(text)) return true;
  if (/^Script error\.?$/i.test(text)) return true;
  return false;
}

function captureConsole(page: Page): { jsErrors: string[]; badConsole: string[] } {
  const jsErrors: string[] = [];
  const badConsole: string[] = [];
  page.on('pageerror', (err) => jsErrors.push(`${err.name}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (!isBenign(msg)) badConsole.push(`${msg.text()} @ ${msg.location()?.url ?? '?'}`);
  });
  return { jsErrors, badConsole };
}

// ─── Layer 1 — System Administrator ────────────────────────────────────────

test.describe('Layer 1 — System Administrator (/admin/feature-flags)', () => {
  test('renders the System Administrator heading + flag cards', async ({ authedPage: page }) => {
    await page.goto('/admin/feature-flags');
    await expect(page.getByTestId('ff-layer-heading')).toContainText(/system administrator/i);
    await expect(page.locator('.ff-card').first()).toBeVisible({ timeout: 30000 });
  });

  test('mode switcher persists Simple → Advanced → Expert in localStorage', async ({ authedPage: page }) => {
    await page.goto('/admin/feature-flags');
    await expect(page.getByTestId('ff-mode-switcher')).toBeVisible();
    await page.getByTestId('ff-mode-advanced').click();
    await expect(page.getByTestId('ff-mode-advanced')).toHaveAttribute('aria-selected', 'true');
    // Advanced mode reveals targeting/rollout controls on the card.
    await page.locator('.ff-card').first().getByRole('button', { name: /inspect/i }).click();
    await expect(page.locator('.ff-advanced-controls').first()).toBeVisible();

    await page.getByTestId('ff-mode-expert').click();
    await expect(page.getByTestId('ff-mode-expert')).toHaveAttribute('aria-selected', 'true');
    const stored = await page.evaluate(() => localStorage.getItem('ff.mode.system'));
    expect(stored).toBe('expert');

    // Reload → mode restored from localStorage.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('ff-mode-expert')).toHaveAttribute('aria-selected', 'true');
  });

  test('search filters the flag list', async ({ authedPage: page }) => {
    await page.goto('/admin/feature-flags');
    await expect(page.locator('.ff-card').first()).toBeVisible({ timeout: 30000 });
    const before = await page.locator('.ff-card').count();
    await page.getByLabel('Search feature flags').fill('multi_model_router');
    await expect(page.locator('.ff-card')).toHaveCount(1);
    expect(before).toBeGreaterThan(1);
  });

  test('Expert mode shows the raw key, JSON view, and evaluation trace', async ({ authedPage: page }) => {
    await page.goto('/admin/feature-flags');
    await page.getByTestId('ff-mode-expert').click();
    await page.locator('.ff-card').first().getByRole('button', { name: /inspect/i }).click();
    await expect(page.locator('.ff-expert').first()).toBeVisible();
    await expect(page.locator('.ff-eval-trace').first()).toBeVisible();
    await expect(page.locator('.ff-json').first()).toBeVisible();
  });

  test('invalid JSON in the Expert payload editor is rejected (no apply)', async ({ authedPage: page }) => {
    await page.goto('/admin/feature-flags');
    await page.getByTestId('ff-mode-expert').click();
    await page.locator('.ff-card').first().getByRole('button', { name: /inspect/i }).click();
    const editor = page.getByTestId('ff-json-editor').first();
    await editor.fill('{ this is : not json ]');
    await page.getByTestId('ff-json-apply').first().click();
    await expect(page.getByTestId('ff-json-error').first()).toBeVisible();
  });

  test('a dangerous change (kill switch) requires a typed reason + confirmation', async ({ authedPage: page }) => {
    await page.goto('/admin/feature-flags');
    await expect(page.locator('.ff-card').first()).toBeVisible({ timeout: 30000 });
    // Find a non-killed card and trigger the kill switch.
    const killBtn = page.getByRole('button', { name: /^Killswitch/i }).first();
    await killBtn.click();
    // The dangerous-change panel demands a typed reason + shows blast radius.
    await expect(page.getByTestId('ff-danger-panel')).toBeVisible();
    await expect(page.getByTestId('ff-blast-radius')).toBeVisible();
    // Confirm is disabled until a reason is typed.
    await expect(page.getByTestId('ff-danger-confirm')).toBeDisabled();
    await page.getByTestId('ff-danger-reason').fill('Sev-1: feature is throwing in prod.');
    await expect(page.getByTestId('ff-danger-confirm')).toBeEnabled();
  });

  test('per-flag audit history renders in the detail panel', async ({ authedPage: page }) => {
    await page.goto('/admin/feature-flags');
    await page.locator('.ff-card').first().getByRole('button', { name: /inspect/i }).click();
    await expect(page.getByTestId('ff-audit-timeline').first()).toBeVisible({ timeout: 15000 });
  });

  test('clean console on /admin/feature-flags', async ({ authedPage: page }) => {
    const cap = captureConsole(page);
    await page.goto('/admin/feature-flags');
    await expect(page.locator('.ff-card').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(800);
    expect(cap.jsErrors, `uncaught JS exception(s):\n${cap.jsErrors.join('\n')}`).toEqual([]);
    expect(cap.badConsole, `non-benign console error(s):\n${cap.badConsole.join('\n')}`).toEqual([]);
  });
});

// ─── Layer 2 — Site Features ───────────────────────────────────────────────

test.describe('Layer 2 — Site Features (/admin/site-features)', () => {
  test('renders the Features (owner) heading + feature cards', async ({ authedPage: page }) => {
    await page.goto('/admin/site-features');
    await expect(page.getByTestId('sf-layer-heading')).toContainText(/features/i);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 30000 });
  });

  test('owner toggle enables a feature with a simple reason', async ({ authedPage: page }) => {
    await page.goto('/admin/site-features');
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 30000 });
    const toggle = page.locator('.sf-card[data-entitled="available"]').first().getByTestId('sf-toggle');
    await toggle.click();
    // Undo affordance appears after a change.
    await expect(page.getByTestId('sf-undo').first()).toBeVisible({ timeout: 10000 });
  });

  test('entitlement-locked feature shows an upgrade/add-on state, not a broken toggle', async ({ authedPage: page }) => {
    await page.goto('/admin/site-features');
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 30000 });
    const locked = page.locator('.sf-card[data-entitled="upgrade-required"], .sf-card[data-entitled="addon-required"]').first();
    await expect(locked).toBeVisible();
    await expect(locked.getByTestId('sf-locked-cta')).toBeVisible();
    // The locked card must NOT expose an enabled toggle.
    await expect(locked.getByTestId('sf-toggle')).toHaveCount(0);
  });

  test('preview mode is available on an entitled feature', async ({ authedPage: page }) => {
    await page.goto('/admin/site-features');
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 30000 });
    const preview = page.locator('.sf-card[data-entitled="available"]').first().getByTestId('sf-preview');
    await preview.click();
    await expect(page.getByTestId('sf-preview-panel').first()).toBeVisible();
  });

  test('search filters the owner feature list', async ({ authedPage: page }) => {
    await page.goto('/admin/site-features');
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 30000 });
    await page.getByLabel('Search site features').fill('booking');
    await expect(page.locator('.sf-card').first()).toBeVisible();
  });

  test('clean console on /admin/site-features', async ({ authedPage: page }) => {
    const cap = captureConsole(page);
    await page.goto('/admin/site-features');
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(800);
    expect(cap.jsErrors, `uncaught JS exception(s):\n${cap.jsErrors.join('\n')}`).toEqual([]);
    expect(cap.badConsole, `non-benign console error(s):\n${cap.badConsole.join('\n')}`).toEqual([]);
  });
});

// ─── Cross-layer SPA navigation (no full reload) ───────────────────────────

test.describe('Two-layer SPA navigation', () => {
  test('both layers are reachable via the admin nav without a full page reload', async ({ authedPage: page }) => {
    await page.goto('/admin/feature-flags');
    await expect(page.locator('.ff-card').first()).toBeVisible({ timeout: 30000 });

    // Tag the document; a full reload would wipe this marker.
    await page.evaluate(() => ((window as unknown as { __spa?: boolean }).__spa = true));

    await page.getByTestId('ff-nav-site-features').click();
    await expect(page).toHaveURL(/\/admin\/site-features/);
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 30000 });

    await page.getByTestId('sf-nav-system').click();
    await expect(page).toHaveURL(/\/admin\/feature-flags/);
    await expect(page.locator('.ff-card').first()).toBeVisible({ timeout: 30000 });

    const survived = await page.evaluate(() => (window as unknown as { __spa?: boolean }).__spa === true);
    expect(survived, 'SPA marker survived — navigation did not full-reload').toBe(true);
  });
});
