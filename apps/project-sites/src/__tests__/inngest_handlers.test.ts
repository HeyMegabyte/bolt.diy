/**
 * Convergence §20/§42 — Inngest job-trigger handlers.
 *
 * handleEmailRequested closes the dispatch→send loop: it sends the transactional
 * email through the injected email rail and validates the event payload.
 */
import { handleEmailRequested, EmailEventError } from '../inngest/handlers.js';
import { FakeEmailProvider, FakeMarketingEmailProvider } from '../platform/email.js';
import type { EmailRouter } from '../platform/email-router.js';
import type { Env } from '../types/env.js';

const env = {} as Env;

function router() {
  const fake = new FakeEmailProvider();
  const r: EmailRouter = {
    transactional: fake,
    marketing: new FakeMarketingEmailProvider(),
    async sendTransactional(input) {
      return fake.sendTransactional(input);
    },
  };
  return Object.assign(r, { fake });
}

describe('handleEmailRequested', () => {
  it('sends the transactional email via the email rail with the event kind', async () => {
    const r = router();
    const res = await handleEmailRequested(
      env,
      { payload: { to: 'a@b.com', subject: 'Verify', html: '<p>x</p>', kind: 'claim-verification' }, _ctx: { idempotencyKey: 'k1' } },
      { transactional: r.transactional },
    );
    expect(res.accepted).toBe(true);
    expect(r.fake.sent).toHaveLength(1);
    expect(r.fake.sent[0]).toMatchObject({ kind: 'claim-verification', to: 'a@b.com', idempotencyKey: 'k1' });
  });

  it('defaults missing kind to transactional', async () => {
    const r = router();
    await handleEmailRequested(env, { payload: { to: 'a@b.com', subject: 'S', html: 'h' } }, { transactional: r.transactional });
    expect(r.fake.sent[0].kind).toBe('transactional');
  });

  it('throws EmailEventError when payload is incomplete', async () => {
    await expect(handleEmailRequested(env, { payload: { to: 'a@b.com', subject: 'S' } })).rejects.toBeInstanceOf(EmailEventError);
    await expect(handleEmailRequested(env, {})).rejects.toBeInstanceOf(EmailEventError);
  });
});
