/**
 * admin-email.spec.ts — TDD RED phase
 *
 * Every system event (error, billing, snapshot fail, signup, support, deploy)
 * triggers an email to brian@megabyte.space.
 * Asserted via mocked Resend client sendEmail spy.
 */

import { test, expect } from '../_fixtures/auth.js';

interface ResendCall {
  to: string;
  subject: string;
  eventType: string;
}

const SUPER_ADMIN_EMAIL = 'brian@megabyte.space';

const SYSTEM_EVENTS = [
  { eventType: 'system.error', subject: /error|exception/i, triggerPath: '/api/dev/trigger/system-error' },
  { eventType: 'billing.updated', subject: /billing|subscription/i, triggerPath: '/api/dev/trigger/billing-updated' },
  { eventType: 'snapshot.failed', subject: /snapshot|failed/i, triggerPath: '/api/dev/trigger/snapshot-failed' },
  { eventType: 'user.signup', subject: /signup|new user|welcome/i, triggerPath: '/api/dev/trigger/user-signup' },
  { eventType: 'support.ticket', subject: /support|ticket/i, triggerPath: '/api/dev/trigger/support-ticket' },
  { eventType: 'deploy.completed', subject: /deploy|deployment/i, triggerPath: '/api/dev/trigger/deploy-completed' },
] as const;

test.describe('admin email notifications', () => {
  test.beforeEach(async ({ authedPage }) => {
    // Intercept all Resend API calls and record them
    await authedPage.route('**/api/email/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: `email-${Date.now()}`, sent: true }),
      });
    });

    await authedPage.goto('/');
  });

  for (const { eventType, subject, triggerPath } of SYSTEM_EVENTS) {
    test(`"${eventType}" event sends email to ${SUPER_ADMIN_EMAIL}`, async ({ authedPage }) => {
      const resendCalls: ResendCall[] = [];

      // Spy on the internal email dispatch endpoint
      await authedPage.route('**/api/notifications/email**', async (route) => {
        const body = await route.request().postDataJSON() as ResendCall;
        resendCalls.push(body);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sent: true }),
        });
      });

      // Also intercept Resend direct calls
      await authedPage.route('**/resend.com/emails**', async (route) => {
        const body = await route.request().postDataJSON() as ResendCall;
        resendCalls.push(body);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'resend-mock-id' }),
        });
      });

      // Trigger the event via dev-only endpoint
      const response = await authedPage.request.post(triggerPath, {
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ eventType }),
      });

      // Dev trigger should succeed
      expect([200, 201, 204]).toContain(response.status());

      // Wait briefly for async email dispatch
      await authedPage.waitForTimeout(500);

      // Assert at least one email was dispatched to the super-admin
      const adminEmail = resendCalls.find((c) => {
        const to = typeof c.to === 'string' ? c.to : JSON.stringify(c.to);
        return to.includes(SUPER_ADMIN_EMAIL);
      });

      expect(
        adminEmail,
        `Expected an email to ${SUPER_ADMIN_EMAIL} for event "${eventType}". Calls made: ${JSON.stringify(resendCalls)}`,
      ).toBeDefined();

      if (adminEmail?.subject) {
        expect(adminEmail.subject).toMatch(subject);
      }
    });
  }
});
