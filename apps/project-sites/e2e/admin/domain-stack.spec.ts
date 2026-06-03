/**
 * ADMIN-DOMAIN-STACK — /admin/domains/:id/stack One-Click Stack Wizard renders
 *
 * Route `domains/:id/stack` lazy-loads {@link AdminDomainStackComponent} — the
 * domain stack wizard surface: a "Domain Stack" kicker + "One-Click Stack
 * Wizard" heading, a "← Domains" back link, and (when a site + primary
 * hostname + a stack run exist) a cyan `role=progressbar` completion meter
 * driving a 7-tile `role=list` setup board.
 *
 * The header (kicker + heading + back link) renders UNCONDITIONALLY — it sits
 * outside every `@if` gate. The completion meter + tile board are gated behind
 * `hostname() && tiles().length > 0`, which the stubbed E2E server does not
 * satisfy (no selected site / no live stack run), so this spec asserts the
 * always-rendered wizard shell per the harness's "assert only always-rendered
 * elements" contract.
 *
 * Per [[e2e-tdd-organization]]: goto('/') (via authedPage fixture) → navigate
 * to the sub-route → assert the wizard shell renders. Deterministic (locator
 * waits only), parallel-safe (isolated authed context), stable selectors
 * (role / visible text).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-DOMAIN-STACK — /admin/domains/:id/stack wizard renders', () => {
  test('domain stack wizard shell heading and back link are visible', async ({
    authedPage: page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/domains/site-megabytespace-001/stack`);

    // Wizard shell heading (always rendered — outside every @if gate).
    await expect(
      page.locator('h2').filter({ hasText: /One-Click Stack Wizard/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // "Domain Stack" kicker label above the heading.
    await expect(page.locator('.kicker').filter({ hasText: /Domain Stack/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Back link to the Domains section.
    await expect(page.getByRole('link', { name: /Domains/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
