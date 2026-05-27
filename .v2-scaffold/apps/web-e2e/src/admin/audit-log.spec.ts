/**
 * audit-log.spec.ts — TDD RED phase
 *
 * Super-admin /dashboard/admin/audit:
 * - Filters by actor, action, target, date
 */

import { test, expect } from '../_fixtures/auth.js';

const MOCK_AUDIT_ENTRIES = [
  {
    id: 'audit-001',
    actor: 'brian@megabyte.space',
    action: 'invite.sent',
    target: 'new@example.com',
    timestamp: new Date('2026-05-01T10:00:00Z').toISOString(),
  },
  {
    id: 'audit-002',
    actor: 'crew@example.com',
    action: 'job.accepted',
    target: 'job-001',
    timestamp: new Date('2026-05-02T11:00:00Z').toISOString(),
  },
  {
    id: 'audit-003',
    actor: 'brian@megabyte.space',
    action: 'billing.upgraded',
    target: 'plan-pro',
    timestamp: new Date('2026-05-03T12:00:00Z').toISOString(),
  },
];

test.describe('audit log', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.route('**/api/admin/audit**', async (route) => {
      const url = new URL(route.request().url());
      let results = [...MOCK_AUDIT_ENTRIES];

      const actor = url.searchParams.get('actor');
      const action = url.searchParams.get('action');
      const target = url.searchParams.get('target');
      const since = url.searchParams.get('since');

      if (actor) results = results.filter((e) => e.actor.includes(actor));
      if (action) results = results.filter((e) => e.action.includes(action));
      if (target) results = results.filter((e) => e.target.includes(target));
      if (since) results = results.filter((e) => new Date(e.timestamp) >= new Date(since));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: results, total: results.length }),
      });
    });

    await authedPage.goto('/');
    const adminLink = authedPage
      .getByRole('link', { name: /admin/i })
      .or(authedPage.getByTestId('nav-admin'));
    await adminLink.click();
    await expect(authedPage).toHaveURL(/\/admin/);

    const auditLink = authedPage
      .getByRole('link', { name: /audit/i })
      .or(authedPage.getByTestId('nav-audit-log'));
    await auditLink.click();
    await expect(authedPage).toHaveURL(/\/admin\/audit/);
  });

  test('all audit entries are visible by default', async ({ authedPage }) => {
    for (const entry of MOCK_AUDIT_ENTRIES) {
      await expect(authedPage.getByText(entry.action)).toBeVisible({ timeout: 8_000 });
    }
  });

  test('filter by actor narrows results', async ({ authedPage }) => {
    const actorFilter = authedPage
      .getByRole('textbox', { name: /actor|user/i })
      .or(authedPage.getByTestId('audit-filter-actor'));
    await expect(actorFilter).toBeVisible({ timeout: 5_000 });
    await actorFilter.fill('brian@megabyte.space');
    await authedPage.keyboard.press('Enter');

    // Should show brian's entries only
    await expect(authedPage.getByText('invite.sent')).toBeVisible({ timeout: 5_000 });
    await expect(authedPage.getByText('billing.upgraded')).toBeVisible();
    await expect(authedPage.getByText('job.accepted')).not.toBeVisible();
  });

  test('filter by action narrows results', async ({ authedPage }) => {
    const actionFilter = authedPage
      .getByRole('textbox', { name: /action/i })
      .or(authedPage.getByTestId('audit-filter-action'));
    await expect(actionFilter).toBeVisible({ timeout: 5_000 });
    await actionFilter.fill('invite');
    await authedPage.keyboard.press('Enter');

    await expect(authedPage.getByText('invite.sent')).toBeVisible({ timeout: 5_000 });
    await expect(authedPage.getByText('job.accepted')).not.toBeVisible();
  });

  test('filter by target narrows results', async ({ authedPage }) => {
    const targetFilter = authedPage
      .getByRole('textbox', { name: /target/i })
      .or(authedPage.getByTestId('audit-filter-target'));
    await expect(targetFilter).toBeVisible({ timeout: 5_000 });
    await targetFilter.fill('job-001');
    await authedPage.keyboard.press('Enter');

    await expect(authedPage.getByText('job.accepted')).toBeVisible({ timeout: 5_000 });
    await expect(authedPage.getByText('invite.sent')).not.toBeVisible();
  });

  test('filter by date filters entries before that date', async ({ authedPage }) => {
    const dateFilter = authedPage
      .getByRole('textbox', { name: /date|since|from/i })
      .or(authedPage.getByTestId('audit-filter-date'));
    await expect(dateFilter).toBeVisible({ timeout: 5_000 });
    await dateFilter.fill('2026-05-02');
    await authedPage.keyboard.press('Enter');

    // Only entries from 2026-05-02 onwards
    await expect(authedPage.getByText('job.accepted')).toBeVisible({ timeout: 5_000 });
    await expect(authedPage.getByText('billing.upgraded')).toBeVisible();
    await expect(authedPage.getByText('invite.sent')).not.toBeVisible();
  });
});
