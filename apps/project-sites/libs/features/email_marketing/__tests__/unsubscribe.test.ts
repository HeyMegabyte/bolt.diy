/**
 * Unit tests for signed unsubscribe tokens (CAN-SPAM/GDPR compliance path).
 * Covers: sign→verify roundtrip, email case-normalization, forged-signature and
 * malformed-payload rejection, and footer HTML containing the link.
 */

import {
  signUnsubToken,
  verifyUnsubToken,
  unsubscribeUrl,
  unsubscribeFooterHtml,
} from '../unsubscribe.js';
import type { Env } from '../../../../src/types/env.js';

const env = { STRIPE_WEBHOOK_SECRET: 'test-signing-secret' } as unknown as Env;

describe('email_marketing unsubscribe tokens', () => {
  it('round-trips a valid token back to email + siteId', async () => {
    const { u, s } = await signUnsubToken(env, 'Ada@Example.com', 'site1');
    const tok = await verifyUnsubToken(env, u, s);
    expect(tok).toEqual({ siteId: 'site1', email: 'ada@example.com' }); // lowercased
  });

  it('rejects a forged signature', async () => {
    const { u } = await signUnsubToken(env, 'a@x.com', 'site1');
    expect(await verifyUnsubToken(env, u, 'deadbeef'.repeat(8))).toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', async () => {
    const { s } = await signUnsubToken(env, 'a@x.com', 'site1');
    const forgedU = Buffer.from('site1|victim@x.com').toString('base64url');
    expect(await verifyUnsubToken(env, forgedU, s)).toBeNull();
  });

  it('rejects malformed base64 / missing pipe', async () => {
    expect(await verifyUnsubToken(env, 'not%%%base64', 'x')).toBeNull();
    const noPipe = Buffer.from('nopipehere').toString('base64url');
    const { s } = await signUnsubToken(env, 'a@x.com', 'site1');
    expect(await verifyUnsubToken(env, noPipe, s)).toBeNull();
  });

  it('builds an absolute URL and a footer that links to it', async () => {
    const url = await unsubscribeUrl(env, 'a@x.com', 'site1');
    expect(url).toMatch(/^https:\/\/.+\/api\/marketing\/unsubscribe\?u=.+&s=.+$/);
    const footer = unsubscribeFooterHtml(url);
    expect(footer).toContain(url);
    expect(footer.toLowerCase()).toContain('unsubscribe');
  });
});
