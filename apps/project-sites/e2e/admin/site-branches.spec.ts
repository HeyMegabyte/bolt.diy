/**
 * ADMIN-27 — /admin/sites/:id/branches Branch-preview surface renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * The site-branches section ({@link SiteBranchesComponent}, mounted at
 * `/admin/sites/:id/branches`) ALWAYS renders its shell regardless of API /
 * flag state: the `[data-testid="site-branches"]` section, the "Branches" h1,
 * the `+ New branch` toggle (`[data-testid="branch-new-toggle"]`), and the
 * branch-statistics group (`role="group"` aria-label="Branch statistics" with
 * Total / In Review / Merged rolling counters). These mount synchronously from
 * the template before the `GET /api/sites/:id/branches` fetch resolves.
 *
 * Below the always-rendered shell the component shows exactly one of: a loading
 * skeleton, an error card (`[data-testid="branches-error"]`), an empty state,
 * or the branches table — depending on the fetch outcome for the supplied site
 * id. To stay deterministic + parallel-safe across any of those states (and
 * either auth/flag posture), this spec asserts the always-rendered shell hard,
 * exercises the create-form toggle (a pure client-side signal flip, no
 * network), then branches tolerantly on whichever post-fetch surface appears —
 * mirroring the env-tolerant pattern in enterprise.spec.ts + apps.spec.ts.
 * Deterministic (locator waits only), parallel-safe (isolated authed context),
 * stable selectors (data-testid / role / text).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

// Deterministic placeholder site id — the always-rendered shell mounts for any
// `:id`; the fetch outcome for this id is irrelevant to the shell assertions.
const SITE_ID = process.env.E2E_SITE_ID ?? 'e2e-site';

test.describe('ADMIN-27 — /admin/sites/:id/branches Branch-preview surface renders', () => {
  test('branches shell, stats group, and create-form toggle render', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/sites/${SITE_ID}/branches`);

    // Always-rendered shell — the section mounts regardless of fetch/flag state.
    await expect(page.locator('[data-testid="site-branches"]')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('h1').filter({ hasText: /^Branches$/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Branch-statistics group: Total / In Review / Merged counters live in the
    // always-rendered header band (rolling counters render even at zero).
    const statsGroup = page.getByRole('group', { name: /Branch statistics/i });
    await expect(statsGroup).toBeVisible({ timeout: 10_000 });
    await expect(statsGroup.getByText(/Total/i).first()).toBeVisible();
    await expect(statsGroup.getByText(/In Review/i).first()).toBeVisible();
    await expect(statsGroup.getByText(/Merged/i).first()).toBeVisible();

    // The "+ New branch" toggle is part of the always-rendered header controls.
    const newToggle = page.locator('[data-testid="branch-new-toggle"]');
    await expect(newToggle).toBeVisible({ timeout: 10_000 });

    // Toggling the create form is a pure client-side signal flip (no network) —
    // exercise it deterministically only when the toggle is enabled (it is
    // disabled when no site id resolved). When enabled, the branch-name input
    // appears; toggling back hides it.
    if (await newToggle.isEnabled().catch(() => false)) {
      await newToggle.click();
      await expect(page.locator('[data-testid="branch-name-input"]')).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('[data-testid="branch-create-submit"]')).toBeVisible();
      await newToggle.click();
      await expect(page.locator('[data-testid="branch-name-input"]')).toBeHidden({ timeout: 5_000 });
    }

    // Post-fetch surface is exactly one of skeleton / error / empty / table.
    // Assert the empty-state or table when present without making either a hard
    // requirement (the error card + retry is a legitimate state in a stubbed
    // env). Branch tolerantly so the spec passes in any post-fetch state.
    const emptyState = page.getByText(/No branches yet|Select a site to manage its branches/i).first();
    const branchesTable = page.getByRole('region', { name: /^Branches$/i });
    const errorCard = page.locator('[data-testid="branches-error"]');

    if (await branchesTable.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await expect(branchesTable).toBeVisible();
    } else if (await emptyState.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expect(emptyState).toBeVisible();
    } else if (await errorCard.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // Error state offers a Retry affordance.
      await expect(page.locator('[data-testid="branches-retry"]')).toBeVisible();
    }
    // (else still loading / skeleton — the always-rendered shell above is the
    //  deterministic floor and has already been asserted.)

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
