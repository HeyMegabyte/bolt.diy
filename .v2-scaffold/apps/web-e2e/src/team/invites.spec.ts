/**
 * invites.spec.ts — TDD RED phase
 *
 * Invite by email, pending invite row, resend, revoke.
 */

import { test, expect } from '../_fixtures/auth.js';

const INVITE_EMAIL = 'new-member@example.com';

test.describe('team invites', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.route('**/api/team/invites**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'invite-001',
              email: INVITE_EMAIL,
              status: 'pending',
              sentAt: new Date().toISOString(),
            },
          ]),
        });
      } else if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'invite-new', email: INVITE_EMAIL, status: 'pending' }),
        });
      } else {
        await route.continue();
      }
    });

    await authedPage.route('**/api/team/invites/*/resend**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ resent: true }),
      });
    });

    await authedPage.route('**/api/team/invites/*/revoke**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ revoked: true }),
      });
    });

    await authedPage.goto('/');
    const teamLink = authedPage
      .getByRole('link', { name: /team|members/i })
      .or(authedPage.getByTestId('nav-team'));
    await teamLink.click();
    await expect(authedPage).toHaveURL(/\/team/);
  });

  test('invite by email creates a pending row', async ({ authedPage }) => {
    const inviteBtn = authedPage
      .getByRole('button', { name: /invite|add member/i })
      .or(authedPage.getByTestId('team-invite-btn'));
    await expect(inviteBtn).toBeVisible({ timeout: 8_000 });
    await inviteBtn.click();

    const emailInput = authedPage
      .getByRole('textbox', { name: /email/i })
      .or(authedPage.getByTestId('invite-email-input'));
    await expect(emailInput).toBeVisible();
    await emailInput.fill(INVITE_EMAIL);

    const sendBtn = authedPage
      .getByRole('button', { name: /send invite|invite/i })
      .or(authedPage.getByTestId('invite-send-btn'));
    await sendBtn.click();

    // Pending row should appear in the team member list
    await expect(
      authedPage.getByText(INVITE_EMAIL),
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      authedPage.getByText(/pending/i),
    ).toBeVisible();
  });

  test('resend invite triggers API call and shows toast', async ({ authedPage }) => {
    let resendCalled = false;
    await authedPage.route('**/api/team/invites/*/resend**', async (route) => {
      resendCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ resent: true }),
      });
    });

    // Pending row should already be present from the GET mock
    const inviteRow = authedPage
      .getByTestId('invite-row-invite-001')
      .or(authedPage.getByText(INVITE_EMAIL).locator('..'));
    await expect(inviteRow).toBeVisible({ timeout: 8_000 });

    const resendBtn = inviteRow
      .getByRole('button', { name: /resend/i })
      .or(inviteRow.getByTestId('invite-resend-btn'));
    await resendBtn.click();

    await expect(
      authedPage.getByRole('status').or(authedPage.getByTestId('toast-success')),
    ).toBeVisible({ timeout: 5_000 });

    expect(resendCalled).toBe(true);
  });

  test('revoking invite removes it from the list', async ({ authedPage }) => {
    const inviteRow = authedPage
      .getByTestId('invite-row-invite-001')
      .or(authedPage.getByText(INVITE_EMAIL).locator('..'));
    await expect(inviteRow).toBeVisible({ timeout: 8_000 });

    const revokeBtn = inviteRow
      .getByRole('button', { name: /revoke|remove/i })
      .or(inviteRow.getByTestId('invite-revoke-btn'));
    await revokeBtn.click();

    // Confirm dialog may appear
    const confirmDialog = authedPage.getByRole('dialog');
    if (await confirmDialog.isVisible()) {
      await confirmDialog.getByRole('button', { name: /confirm|yes|revoke/i }).click();
    }

    // Row should be gone
    await expect(
      authedPage.getByText(INVITE_EMAIL),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});
