/**
 * Convergence §42/ADR-0019 — email port routing + fakes.
 *
 * Locks: chooseEmailPath sends transactional/critical kinds to SES and bulk to
 * Listmonk; the fake providers validate input + record sends (the §16 no-vendor
 * local path the Resend→SES migration is built on).
 */
import {
  chooseEmailPath,
  FakeEmailProvider,
  FakeMarketingEmailProvider,
  EmailInputError,
  type EmailKind,
} from '../platform/email.js';

describe('chooseEmailPath (§42)', () => {
  it('routes transactional/critical kinds to SES', () => {
    const ses: EmailKind[] = [
      'magic-link',
      'claim-verification',
      'receipt',
      'billing-alert',
      'security',
      'domain-verification',
      'transactional',
    ];
    for (const k of ses) expect(chooseEmailPath(k)).toBe('ses');
  });

  it('routes bulk kinds to Listmonk', () => {
    for (const k of ['newsletter', 'campaign', 'lifecycle'] as EmailKind[]) {
      expect(chooseEmailPath(k)).toBe('listmonk');
    }
  });
});

describe('FakeEmailProvider', () => {
  it('accepts a valid transactional send + records it', async () => {
    const p = new FakeEmailProvider();
    const r = await p.sendTransactional({
      to: 'a@b.com',
      subject: 'Hi',
      html: '<p>x</p>',
      kind: 'receipt',
      idempotencyKey: 'k1',
    });
    expect(r).toEqual({ id: 'k1', accepted: true });
    expect(p.sent).toHaveLength(1);
  });

  it('accepts multiple recipients', async () => {
    const p = new FakeEmailProvider();
    await p.sendTransactional({
      to: ['a@b.com', 'c@d.com'],
      subject: 'S',
      html: 'h',
      kind: 'transactional',
    });
    expect(p.sent[0].to).toEqual(['a@b.com', 'c@d.com']);
  });

  it('rejects an invalid recipient / missing subject / missing html', async () => {
    const p = new FakeEmailProvider();
    await expect(
      p.sendTransactional({ to: 'nope', subject: 'S', html: 'h', kind: 'security' }),
    ).rejects.toBeInstanceOf(EmailInputError);
    await expect(
      p.sendTransactional({ to: 'a@b.com', subject: '', html: 'h', kind: 'security' }),
    ).rejects.toThrow(/subject/);
    await expect(
      p.sendTransactional({ to: 'a@b.com', subject: 'S', html: '', kind: 'security' }),
    ).rejects.toThrow(/html/);
    expect(p.sent).toHaveLength(0);
  });
});

describe('FakeMarketingEmailProvider', () => {
  it('upserts subscriber, creates + sends campaign, unsubscribes', async () => {
    const m = new FakeMarketingEmailProvider();
    expect((await m.upsertSubscriber({ email: 'a@b.com' })).id).toBe('sub_1');
    const camp = await m.createCampaign({ name: 'June', subject: 'News', body: '<p>hi</p>' });
    expect(camp.id).toBe('camp_1');
    expect((await m.sendCampaign({ campaignId: camp.id })).started).toBe(true);
    await m.unsubscribe({ email: 'a@b.com' });
    expect(m.sentCampaigns).toEqual(['camp_1']);
    expect(m.unsubscribed).toEqual(['a@b.com']);
  });

  it('rejects an invalid subscriber email', async () => {
    const m = new FakeMarketingEmailProvider();
    await expect(m.upsertSubscriber({ email: 'bad' })).rejects.toBeInstanceOf(EmailInputError);
  });
});
