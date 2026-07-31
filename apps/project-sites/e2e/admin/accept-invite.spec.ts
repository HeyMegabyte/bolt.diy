/**
 * ADMIN-31 — /admin/accept-invite org invitation acceptance
 *
 * MODERNIZED 2026-07-31 (residual-admin triage). The surface is REAL and
 * uncovered by any root-level journey: `/admin/accept-invite?token=…` is the
 * team-invite acceptance landing ({@link AdminAcceptInviteComponent},
 * `app.routes.ts` § `accept-invite`). It POSTs the token to
 * `/api/team/invites/accept` and renders exactly one of three states:
 * verifying (spinner) / success ("Joined" + 1.2s redirect to /admin) /
 * error ("Couldn't accept invite" + server message + "Go to admin").
 * The old spec asserted `h2` headings — the component renders `h1` — so it
 * could never have passed; every heading assert below matches the shipped DOM.
 *
 * Contracts under test (hard asserts — stubs make every state deterministic):
 *  1. Missing token → client-side error state, exact copy, Go-to-admin escape.
 *  2. Valid token → POST body carries the token → "Joined" → auto-redirect.
 *  3. Rejected token (410) → server message surfaced verbatim, role=alert.
 *  4. Value-domain sweep on `?token=` (XSS / SQLish / unicode / long /
 *     whitespace) → calm error state every time, message rendered as TEXT,
 *     no dialogs, no console errors.
 *
 * House pattern: authedPage fixture (signInAsTestUser ran inside the fixture);
 * test-body stubs are registered AFTER the helper so Playwright's
 * reverse-registration matching lets them beat the helper's benign catch-all.
 * Glob-law: every route pattern ships its `?**` query twin.
 */

import { test, expect } from '../fixtures.js';
import type { Page, Route } from '@playwright/test';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev';

/** Console-error collector with the house noise filter (settings-journey idiom). */
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

/** Stubs POST /api/team/invites/accept with a fixed response. `?**` twin per glob-law. */
async function stubAccept(
  page: Page,
  respond: (route: Route) => Promise<void>,
): Promise<void> {
  await page.route('**/api/team/invites/accept', respond);
  await page.route('**/api/team/invites/accept?**', respond);
}

test.describe('ADMIN-31 — /admin/accept-invite org invitation acceptance', () => {
  test('missing token renders the error state with a Go-to-admin escape', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(`${BASE}/admin/accept-invite`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const section = page.locator('[data-testid="accept-invite-section"]');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // No token → pure client-side error, no POST ever fires.
    await expect(
      section.locator('h1').filter({ hasText: /Couldn't accept invite/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(section.getByText('Missing token in URL.')).toBeVisible({ timeout: 5_000 });
    await expect(section.locator('[data-testid="invite-glyph"]')).toBeVisible();
    await expect(section.locator('section[role="alert"]')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/admin-accept-invite/01-missing-token.png' });

    // The escape hatch navigates back to the admin hub (SPA click, not reload).
    await section.getByRole('button', { name: /Go to admin/i }).click();
    await page.waitForURL(/\/admin(\?|$)/, { timeout: 10_000 });

    expect(realErrors(errors)).toHaveLength(0);
  });

  test('valid token POSTs, shows Joined, and auto-redirects to /admin', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    let postedToken: string | null = null;

    await stubAccept(page, async (route) => {
      const body = route.request().postDataJSON() as { token?: string };
      postedToken = body?.token ?? null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { joined: true, role: 'editor' } }),
      });
    });

    await page.goto(`${BASE}/admin/accept-invite?token=inv-e2e-valid-token`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const section = page.locator('[data-testid="accept-invite-section"]');
    await expect(section).toBeVisible({ timeout: 15_000 });
    await expect(section.locator('h1').filter({ hasText: /^Joined$/ })).toBeVisible({
      timeout: 10_000,
    });

    await page.screenshot({ path: 'e2e/screenshots/admin-accept-invite/02-joined.png' });

    // POST body carried the exact token from the URL.
    expect(postedToken).toBe('inv-e2e-valid-token');

    // Component redirects to /admin after ~1.2s.
    await page.waitForURL(/\/admin(\?|$)/, { timeout: 10_000 });

    expect(realErrors(errors)).toHaveLength(0);
  });

  test('rejected token (410) surfaces the server message verbatim as an alert', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    const serverMessage = 'This invite has expired. Ask your admin for a new one.';

    await stubAccept(page, async (route) => {
      await route.fulfill({
        status: 410,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INVITE_EXPIRED', message: serverMessage } }),
      });
    });

    await page.goto(`${BASE}/admin/accept-invite?token=inv-e2e-expired`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const section = page.locator('[data-testid="accept-invite-section"]');
    await expect(section).toBeVisible({ timeout: 15_000 });
    await expect(
      section.locator('h1').filter({ hasText: /Couldn't accept invite/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(section.getByText(serverMessage)).toBeVisible({ timeout: 5_000 });
    await expect(section.locator('section[role="alert"]')).toBeVisible();
    await expect(section.getByRole('button', { name: /Go to admin/i })).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/admin-accept-invite/03-expired.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });

  test('value-domain sweep on ?token= — hostile tokens render calm text, never execute', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);

    // Any dialog (alert/confirm) means injected markup executed — hard fail.
    page.on('dialog', (d) => {
      throw new Error(`Unexpected dialog from token value: ${d.message()}`);
    });

    await stubAccept(page, async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INVALID_TOKEN', message: 'Invalid invite token.' } }),
      });
    });

    const hostileTokens = [
      '<script>alert(1)</script>', // XSS
      "' OR 1=1--", // SQL-ish
      'café-☕-приглашение', // unicode + emoji
      'a'.repeat(512), // very long
      '%20%20%20', // whitespace-ish (encoded)
    ];

    for (const token of hostileTokens) {
      await page.goto(`${BASE}/admin/accept-invite?token=${encodeURIComponent(token)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      const section = page.locator('[data-testid="accept-invite-section"]');
      await expect(section).toBeVisible({ timeout: 15_000 });
      await expect(
        section.locator('h1').filter({ hasText: /Couldn't accept invite/i }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(section.getByText('Invalid invite token.')).toBeVisible({ timeout: 5_000 });

      // The hostile token never lands in the DOM as live markup.
      await expect(page.locator('[data-testid="accept-invite-section"] script')).toHaveCount(0);
    }

    await page.screenshot({ path: 'e2e/screenshots/admin-accept-invite/04-value-domains.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });
});
