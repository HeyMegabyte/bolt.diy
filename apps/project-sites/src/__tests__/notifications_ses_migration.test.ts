/**
 * Convergence §42/ADR-0019 — sendEmail routes through SES when configured.
 *
 * The first real Resend→SES migration decrement: with AWS creds present, the
 * central transactional sender dispatches via the email router (SES), NOT Resend.
 * Resend stays the documented fallback until SES is proven live.
 */
import { sendEmail, categoryToEmailKind } from '../services/notifications.js';
import type { EmailRouter } from '../platform/email-router.js';
import type { Env } from '../types/env.js';

describe('categoryToEmailKind', () => {
  it('maps known categories + defaults unknown to transactional', () => {
    expect(categoryToEmailKind('magic_link')).toBe('magic-link');
    expect(categoryToEmailKind('claim_verification')).toBe('claim-verification');
    expect(categoryToEmailKind('domain_verified')).toBe('domain-verification');
    expect(categoryToEmailKind('billing_alert')).toBe('billing-alert');
    expect(categoryToEmailKind('invite')).toBe('transactional');
    expect(categoryToEmailKind('whatever')).toBe('transactional');
  });
});

describe('sendEmail SES migration (ADR-0019)', () => {
  const sesEnv = {
    AWS_ACCESS_KEY_ID: 'k',
    AWS_SECRET_ACCESS_KEY: 's',
    SES_FROM_EMAIL: 'noreply@mail.projectsites.dev',
    // RESEND_API_KEY intentionally also set — SES must win regardless.
    RESEND_API_KEY: 're_should_not_be_used',
  } as Env;

  function fakeRouter() {
    const sent: { kind: string; to: string; subject: string }[] = [];
    const router: EmailRouter = {
      transactional: {} as EmailRouter['transactional'],
      marketing: {} as EmailRouter['marketing'],
      async sendTransactional(input) {
        sent.push({ kind: input.kind, to: Array.isArray(input.to) ? input.to[0] : input.to, subject: input.subject });
        return { id: 'ses-1', accepted: true };
      },
    };
    return Object.assign(router, { sent });
  }

  it('dispatches via the SES rail (mapped kind) and never calls Resend', async () => {
    const fetchSpy = jest.fn();
    const orig = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const router = fakeRouter();
      await sendEmail(sesEnv, { to: 'a@b.com', subject: 'Verify', html: '<p>x</p>', category: 'claim_verification' }, { email: router });
      expect(router.sent).toEqual([{ kind: 'claim-verification', to: 'a@b.com', subject: 'Verify' }]);
      expect(fetchSpy).not.toHaveBeenCalled(); // Resend/SendGrid NOT hit
    } finally {
      globalThis.fetch = orig;
    }
  });
});
