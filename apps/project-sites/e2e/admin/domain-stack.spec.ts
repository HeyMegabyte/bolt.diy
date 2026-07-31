/**
 * ADMIN-DOMAIN-STACK — /admin/domains/:id/stack One-Click Stack Wizard
 *
 * MODERNIZED 2026-07-31 (residual-admin triage). The route
 * `domains/:id/stack` (flag `domain_stack_wizard`) lazy-loads
 * {@link AdminDomainStackComponent}; admin-domains-journey.spec.ts never
 * touches the stack wizard, so this spec owns it. The old spec only asserted
 * the always-rendered header; this one drives all three real states with
 * stubs — the auth helper's site stub carries
 * `primary_hostname: 'e2e-test-site.projectsites.dev'`, so `hostname()`
 * resolves and the component immediately GETs
 * `/api/domains/:hostname/stack-status`.
 *
 * Contracts under test (hard asserts — stubs make every state deterministic):
 *  1. Status with tiles → completion meter (role=progressbar 3/7) + 7-tile
 *     setup board (role=list) + Advance → POST /api/domains/:hn/stack.
 *  2. 404 `feature_disabled` → flag-gate notice naming domain_stack_wizard,
 *     board absent.
 *  3. Site without a primary hostname → "no primary custom hostname" card
 *     with the Add Domain escape to /admin/domains.
 *
 * House pattern: authedPage fixture; test-body stubs registered AFTER the
 * helper (reverse-registration wins); `?**` glob twins on every route. Tile
 * statuses avoid `in_progress` so the component never starts its poller
 * (poller-teardown class closed in pass 13 — keep specs poll-free).
 */

import { test, expect } from '../fixtures.js';
import type { Page, Route } from '@playwright/test';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev';
const SITE_ID = 'e2e-site-001';

const TILES = [
  { step: 'registrar', label: 'Registrar', status: 'done', error: null, data: null },
  { step: 'dns', label: 'DNS', status: 'done', error: null, data: null },
  { step: 'ssl', label: 'SSL', status: 'done', error: null, data: null },
  { step: 'email_auth', label: 'Email Auth', status: 'pending', error: null, data: null },
  { step: 'security_txt', label: 'security.txt', status: 'pending', error: null, data: null },
  { step: 'gsc', label: 'Search Console', status: 'pending', error: null, data: null },
  { step: 'verify', label: 'Verify', status: 'pending', error: null, data: null },
];

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

/** Stubs GET stack-status (any hostname) with the given responder. `?**` twins. */
async function stubStackStatus(page: Page, respond: (route: Route) => Promise<void>): Promise<void> {
  await page.route('**/api/domains/*/stack-status', respond);
  await page.route('**/api/domains/*/stack-status?**', respond);
}

test.describe('ADMIN-DOMAIN-STACK — /admin/domains/:id/stack wizard', () => {
  test('status with tiles renders meter + 7-tile board; Advance POSTs', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);

    await stubStackStatus(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            run_id: 'run-e2e-1',
            hostname: 'e2e-test-site.projectsites.dev',
            state: 'pending',
            tiles: TILES,
            done_at: null,
            last_error: null,
            retries: 0,
          },
        }),
      });
    });
    const advance = async (route: Route): Promise<void> => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { run_id: 'run-e2e-1', state: 'pending', step_results: {}, last_error: null },
        }),
      });
    };
    await page.route('**/api/domains/*/stack', advance);
    await page.route('**/api/domains/*/stack?**', advance);

    await page.goto(`${BASE}/admin/domains/${SITE_ID}/stack`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Always-rendered wizard shell.
    await expect(
      page.locator('h2').filter({ hasText: /One-Click Stack Wizard/i }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.kicker').filter({ hasText: /Domain Stack/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Domains/i }).first()).toBeVisible();

    // Completion meter: 3 of 7 done.
    const meter = page.getByRole('progressbar');
    await expect(meter).toBeVisible({ timeout: 10_000 });
    await expect(meter).toHaveAttribute('aria-valuenow', '3');
    await expect(meter).toHaveAttribute('aria-valuemax', '7');

    // 7-tile setup board.
    const board = page.getByRole('list', { name: /Domain stack setup steps/i });
    await expect(board).toBeVisible({ timeout: 10_000 });
    await expect(board.getByRole('listitem')).toHaveCount(7, { timeout: 10_000 });

    await page.screenshot({ path: 'e2e/screenshots/admin-domain-stack/01-board.png' });

    // Advance is armed (state ≠ done/error) and POSTs the stack advance.
    const postPromise = page.waitForRequest(
      (req) => /\/api\/domains\/[^/]+\/stack$/.test(req.url().split('?')[0]) && req.method() === 'POST',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: /Advance domain stack wizard/i }).click();
    await postPromise;

    await page.screenshot({ path: 'e2e/screenshots/admin-domain-stack/02-advanced.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });

  test('feature_disabled 404 shows the flag gate, never the board', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);

    await stubStackStatus(page, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'feature_disabled', message: 'Domain Stack Wizard is not enabled' },
        }),
      });
    });

    await page.goto(`${BASE}/admin/domains/${SITE_ID}/stack`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(
      page.locator('h2').filter({ hasText: /One-Click Stack Wizard/i }).first(),
    ).toBeVisible({ timeout: 20_000 });

    // Honest flag gate (shared primitive) naming the flag key.
    const gate = page.locator('[data-testid="domain-stack-flag-gate"]');
    await expect(gate).toBeVisible({ timeout: 10_000 });
    // The gate renders the human label, not the flag key.
    await expect(gate).toContainText(/Domain Stack Wizard.*isn[’']t enabled/);

    // The board must NOT render behind the gate.
    await expect(page.getByRole('list', { name: /Domain stack setup steps/i })).toHaveCount(0);

    await page.screenshot({ path: 'e2e/screenshots/admin-domain-stack/03-flag-gate.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });

  test('site without a primary hostname shows the Add Domain escape', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);

    // Override the helper's sites stub with a hostname-less site (registered
    // later → matched first). Keeps ONE site so the admin shell still mounts.
    const sites = async (route: Route): Promise<void> => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: SITE_ID,
              slug: 'e2e-test-site',
              name: 'E2E Test Site',
              business_name: 'E2E Test Site',
              status: 'published',
              org_id: 'e2e-test-org',
              primary_hostname: null,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-07-01T00:00:00Z',
            },
          ],
          meta: { total: 1 },
        }),
      });
    };
    await page.route('**/api/sites**', sites);

    await page.goto(`${BASE}/admin/domains/${SITE_ID}/stack`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(
      page.locator('h2').filter({ hasText: /One-Click Stack Wizard/i }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/no primary custom hostname yet/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('link', { name: /Add Domain/i })).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/admin-domain-stack/04-no-hostname.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });
});
