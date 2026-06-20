/**
 * Convergence §42/ADR-0019 — getEmailProvider seam.
 *
 * Locks: env selects SES/Listmonk vs fakes; sendTransactional routes by kind and
 * refuses bulk kinds; injected deps win.
 */
import { getEmailProvider } from '../platform/email-router.js';
import { FakeEmailProvider, FakeMarketingEmailProvider } from '../platform/email.js';
import { AmazonSesEmailProvider } from '../services/ses_email_provider.js';
import { ListmonkMarketingEmailProvider } from '../services/listmonk_email_provider.js';
import type { Env } from '../types/env.js';

describe('getEmailProvider', () => {
  it('falls back to fakes when no rail is configured', () => {
    const r = getEmailProvider({} as Env);
    expect(r.transactional).toBeInstanceOf(FakeEmailProvider);
    expect(r.marketing).toBeInstanceOf(FakeMarketingEmailProvider);
  });

  it('selects SES when AWS creds are present', () => {
    const r = getEmailProvider({ AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's' } as Env);
    expect(r.transactional).toBeInstanceOf(AmazonSesEmailProvider);
  });

  it('selects Listmonk when its config is present', () => {
    const r = getEmailProvider({ LISTMONK_API_URL: 'https://m', LISTMONK_USERNAME: 'u', LISTMONK_PASSWORD: 'p' } as Env);
    expect(r.marketing).toBeInstanceOf(ListmonkMarketingEmailProvider);
  });

  it('sendTransactional routes a transactional kind to the transactional rail', async () => {
    const fake = new FakeEmailProvider();
    const r = getEmailProvider({} as Env, { transactional: fake });
    const res = await r.sendTransactional({ kind: 'receipt', to: 'a@b.com', subject: 'S', html: '<p>x</p>' });
    expect(res.accepted).toBe(true);
    expect(fake.sent).toHaveLength(1);
  });

  it('sendTransactional refuses a bulk kind', async () => {
    const fake = new FakeEmailProvider();
    const r = getEmailProvider({} as Env, { transactional: fake });
    await expect(r.sendTransactional({ kind: 'newsletter', to: 'a@b.com', subject: 'S', html: 'h' })).rejects.toThrow(/bulk kind/);
    expect(fake.sent).toHaveLength(0);
  });
});
