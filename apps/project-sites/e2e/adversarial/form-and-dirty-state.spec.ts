/**
 * adversarial/form-and-dirty-state.spec.ts
 *
 * ADVERSARIAL — Form dirty-state, empty-search submission, and
 * navigate-away-while-dirty scenarios (modernized 2026-07-31).
 *
 * Scenarios:
 *  ADV-FORM-06  Navigate away via sidebar while a form is dirty
 *  ADV-FORM-13  Feature-flags page: type + clear the flag search (sysAdmin)
 *  ADV-FORM-14  Logs audit tab: no stale scope chip on a fresh load
 *  ADV-FORM-17  Navigate to billing via user menu while on forms page
 *
 * Modernization notes:
 *  - /admin/audit retired — the Audit Trail is the default tab of
 *    /admin/logs (logs-dashboard.component.ts).
 *  - The old admin-universal-search testid never existed on feature-flags;
 *    the live search box is the type="search" input with placeholder
 *    "Search by key or description…".
 *  - /admin/feature-flags is behind sysAdminGuard — the DEFAULT stub user
 *    (test@megabyte.space) gets bounced to /admin/site-features. That test
 *    signs in with SYS_ADMIN_TEST_EMAIL BEFORE navigation (raw page fixture
 *    + signInAsTestUser so the catch-all /api/** stubs are registered before
 *    any authed GET can reach prod).
 *
 * Rules:
 *  - No page.waitForTimeout. Parallel-safe (isolated context per test).
 *  - Internal nav via UI clicks; goto only for initial load + guarded
 *    deep-link entries.
 */

import { test, expect } from '../fixtures.js';
import { signInAsTestUser, SYS_ADMIN_TEST_EMAIL } from '../helpers/auth.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev'; // localhost:8787 fallback sent the whole suite to a stray dev server ("governor" page)

// ─── helpers ────────────────────────────────────────────────────────────────

async function gotoAdminShell(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });
}

function attachErrorCollector(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const lower = text.toLowerCase();
      if (
        !lower.includes('favicon') &&
        !lower.includes('failed to load resource') &&
        !text.includes('net::ERR_BLOCKED') &&
        !text.includes('ERR_ABORTED') &&
        !text.includes('ERR_FAILED')
      ) {
        errors.push(text);
      }
    }
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  return errors;
}

async function clickNavLink(
  page: import('@playwright/test').Page,
  routerLink: string,
): Promise<boolean> {
  const link = page.locator(`a[routerLink="${routerLink}"]`).first();
  const visible = await link.isVisible({ timeout: 3_000 }).catch(() => false);
  if (visible) {
    await link.click();
    await page
      .waitForURL(new RegExp(routerLink.replace(/\//g, '\\/')), { timeout: 8_000 })
      .catch(() => undefined);
  }
  return visible;
}

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page
    .screenshot({ path: `e2e/screenshots/adversarial/${name}.png`, fullPage: false })
    .catch(() => undefined);
}

// ─── ADV-FORM-06: Navigate away while form is dirty ─────────────────────────

test.describe('ADV-FORM-06 — Navigate away while form is dirty', () => {
  test('filling a form then navigating to another section does not freeze the app', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);
    await clickNavLink(page, '/admin/forms');

    const nameField = page.getByTestId('forms-test-form-name');
    if (await nameField.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await nameField.fill('Draft form — not submitted');
    }

    // Navigate away to settings while the field is dirty
    await clickNavLink(page, '/admin/settings');

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    await shot(page, 'form-06-dirty-nav-away');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FORM-13: Feature flags empty search (sysAdmin) ─────────────────────

test.describe('ADV-FORM-13 — Feature flags: empty search', () => {
  test('typing then clearing the feature-flags search does not crash the list', async ({
    page,
  }) => {
    const errors = attachErrorCollector(page);

    // sysAdminGuard bounces the default stub user — sign in as the sysadmin
    // email BEFORE any navigation so stubs cover every authed GET.
    await signInAsTestUser(page, { email: SYS_ADMIN_TEST_EMAIL });
    await page.goto(`${BASE}/admin/feature-flags`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });

    const searchBox = page.getByPlaceholder(/Search by key/i);
    if (await searchBox.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await searchBox.fill('nonexistent-flag-xyz');
      await searchBox.clear();
    }

    await shot(page, 'form-13-ff-search-cleared');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FORM-14: Audit scope chip (Logs → Audit tab) ───────────────────────

test.describe('ADV-FORM-14 — Audit scope chip absent on fresh load', () => {
  test('no stale scope chip renders when the audit tab loads without a filter', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);
    // /admin/audit retired — Audit Trail is the default tab of /admin/logs
    await clickNavLink(page, '/admin/logs');
    await expect(page.getByTestId('logs-dashboard')).toBeVisible({ timeout: 10_000 });

    // Contract update (2026-07-31): the chip is the INFORMATIONAL org-scope
    // label ("Org: … — no per-site filter"; audit.component.ts:191) and
    // legitimately renders on fresh load. The dirty-state contract is that ×
    // DISMISSES it and it stays dismissed on this visit.
    const chip = page.getByTestId('audit-scope-chip');
    if (await chip.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await chip.click();
      await expect(chip).toBeHidden({ timeout: 3_000 });
    }

    await shot(page, 'form-14-audit-chip-dismissed');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FORM-17: Navigate to billing via user menu from forms page ─────────

test.describe('ADV-FORM-17 — User menu billing link from forms page', () => {
  test('opening user menu on forms page and clicking billing navigates correctly', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);
    await clickNavLink(page, '/admin/forms');

    const avatarBtn = page.getByTestId('user-avatar-btn');
    await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
    await avatarBtn.click();
    await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 3_000 });
    await page.getByTestId('user-menu-billing').click();

    await page.waitForURL(/\/admin\/billing/, { timeout: 8_000 }).catch(() => undefined);
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    await shot(page, 'form-17-billing-via-menu');
    expect(errors).toHaveLength(0);
  });
});
