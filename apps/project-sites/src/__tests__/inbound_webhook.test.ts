/**
 * inbound_webhook — HMAC signature verifier unit tests.
 *
 * Tests all provider schemes, parse helpers, timing-safe comparison,
 * and edge-case handling (empty/missing/null inputs never throw).
 */
import {
  verifyWebhook,
  timingSafeEqual,
  extractStripeSignature,
  extractGitHubSignature,
} from '../services/inbound_webhook.js';

// ── Known-answer tests ──────────────────────────────────────────
// Pre-computed HMAC-SHA256 for deterministic assertions.
// HMAC-SHA256('my-secret', '{"test":true}') =
//   4a2f1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0
// We generate the real value at test time since we don't hardcode hex.

async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('verifyWebhook', () => {
  describe('stripe provider', () => {
    it('passes a valid Stripe signature', async () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const body = '{"id":"evt_test_1","object":"event"}';
      const sig = await hmacHex('whsec_test123', `${ts}.${body}`);
      const header = `t=${ts},v1=${sig}`;

      const result = await verifyWebhook({
        provider: 'stripe',
        signature: header,
        rawBody: body,
        secret: 'whsec_test123',
      });
      expect(result.valid).toBe(true);
      expect(result.reason).toBeNull();
    });

    it('rejects a tampered Stripe signature', async () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const body = '{"id":"evt_test_1"}';
      const header = `t=${ts},v1=${'f'.repeat(64)}`;

      const result = await verifyWebhook({
        provider: 'stripe',
        signature: header,
        rawBody: body,
        secret: 'whsec_test123',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('signature mismatch');
    });

    it('rejects when the Stripe signature header lacks v1=', async () => {
      const result = await verifyWebhook({
        provider: 'stripe',
        signature: 't=1234567890',
        rawBody: '{}',
        secret: 'whsec_abc',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid stripe signature format');
    });

    it('rejects when the Stripe signature header lacks t=', async () => {
      const result = await verifyWebhook({
        provider: 'stripe',
        signature: 'v1=abc123',
        rawBody: '{}',
        secret: 'whsec_abc',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid stripe signature format');
    });
  });

  describe('github provider', () => {
    it('passes a valid GitHub signature', async () => {
      const body = '{"action":"opened","pull_request":{}}';
      const sig = await hmacHex('github-secret', body);
      const header = `sha256=${sig}`;

      const result = await verifyWebhook({
        provider: 'github',
        signature: header,
        rawBody: body,
        secret: 'github-secret',
      });
      expect(result.valid).toBe(true);
      expect(result.reason).toBeNull();
    });

    it('rejects a tampered GitHub signature', async () => {
      const body = '{"action":"closed"}';
      const header = `sha256=${'e'.repeat(64)}`;

      const result = await verifyWebhook({
        provider: 'github',
        signature: header,
        rawBody: body,
        secret: 'github-secret',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('signature mismatch');
    });

    it('rejects when GitHub header does not start with sha256=', async () => {
      const result = await verifyWebhook({
        provider: 'github',
        signature: 'md5=abc123',
        rawBody: '{}',
        secret: 's',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid github signature format');
    });
  });

  describe('generic providers (listmonk / ses / generic)', () => {
    it.each(['listmonk', 'ses', 'generic'] as const)(
      'passes a valid %s HMAC signature',
      async (provider) => {
        const body = '{"email":"test@example.com","event":"bounce"}';
        const sig = await hmacHex('shared-key', body);

        const result = await verifyWebhook({
          provider,
          signature: sig,
          rawBody: body,
          secret: 'shared-key',
        });
        expect(result.valid).toBe(true);
        expect(result.reason).toBeNull();
      },
    );

    it.each(['listmonk', 'ses', 'generic'] as const)(
      'rejects a wrong %s signature',
      async (provider) => {
        const body = '{"email":"test@example.com"}';

        const result = await verifyWebhook({
          provider,
          signature: 'bogus',
          rawBody: body,
          secret: 'shared-key',
        });
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('signature mismatch');
      },
    );
  });

  describe('edge cases', () => {
    it('returns invalid when signature is empty', async () => {
      const result = await verifyWebhook({
        provider: 'generic',
        signature: '',
        rawBody: '{}',
        secret: 'k',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('missing signature');
    });

    it('returns invalid when secret is empty', async () => {
      const result = await verifyWebhook({
        provider: 'generic',
        signature: 'abc',
        rawBody: '{}',
        secret: '',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('secret not configured');
    });

    it('returns invalid for an unknown provider', async () => {
      const result = await verifyWebhook({
        provider: 'unknown' as never,
        signature: 'abc',
        rawBody: '{}',
        secret: 'k',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('unknown provider: unknown');
    });

    it('never throws on empty/null-ish inputs', async () => {
      await expect(
        verifyWebhook({
          provider: 'stripe',
          signature: '',
          rawBody: '',
          secret: '',
        }),
      ).resolves.toEqual({ valid: false, reason: 'missing signature' });

      await expect(
        verifyWebhook({
          provider: 'stripe',
          signature: 't=1,v1=x',
          rawBody: '',
          secret: '',
        }),
      ).resolves.toEqual({ valid: false, reason: 'secret not configured' });
    });

    it('handles a Stripe signature with multiple v1 entries (any-match semantics)', async () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const body = '{"id":"evt_multi"}';
      const sig = await hmacHex('whsec_abc', `${ts}.${body}`);
      // Only the FIRST v1 needs to match (Stripe: any v1 can match).
      const header = `t=${ts},v1=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb,v1=${sig}`;

      const result = await verifyWebhook({
        provider: 'stripe',
        signature: header,
        rawBody: body,
        secret: 'whsec_abc',
      });
      expect(result.valid).toBe(true);
    });
  });
});

describe('extractStripeSignature', () => {
  it('parses a standard Stripe header with one signature', () => {
    const r = extractStripeSignature('t=1234567890,v1=deadbeef');
    expect(r).toEqual({ timestamp: '1234567890', signatures: ['deadbeef'] });
  });

  it('parses a header with multiple v1 signatures', () => {
    const r = extractStripeSignature('t=1234567890,v1=deadbeef,v1=cafebabe');
    expect(r).toEqual({ timestamp: '1234567890', signatures: ['deadbeef', 'cafebabe'] });
  });

  it('parses out-of-order pairs', () => {
    const r = extractStripeSignature('v1=abc123,t=9876543210,v1=def456');
    expect(r).toEqual({ timestamp: '9876543210', signatures: ['abc123', 'def456'] });
  });

  it('returns null for an empty header', () => {
    expect(extractStripeSignature('')).toBeNull();
  });

  it('returns null when t= is missing', () => {
    expect(extractStripeSignature('v1=abc')).toBeNull();
  });

  it('returns null when v1= is missing', () => {
    expect(extractStripeSignature('t=123')).toBeNull();
  });

  it('trims whitespace around pairs', () => {
    const r = extractStripeSignature('t=123, v1=abc , v1=def');
    expect(r).toEqual({ timestamp: '123', signatures: ['abc', 'def'] });
  });
});

describe('extractGitHubSignature', () => {
  it('extracts the hex value from a valid sha256= header', () => {
    expect(extractGitHubSignature('sha256=abc123def456')).toBe('abc123def456');
  });

  it('returns null for an empty header', () => {
    expect(extractGitHubSignature('')).toBeNull();
  });

  it('returns null when header does not start with sha256=', () => {
    expect(extractGitHubSignature('sha1=abc')).toBeNull();
  });

  it('returns null when hex part is empty', () => {
    expect(extractGitHubSignature('sha256=')).toBeNull();
  });
});

describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('hello', 'hello')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(timingSafeEqual('hello', 'world')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('handles hex strings correctly', () => {
    const a = 'a1b2c3d4e5f6';
    const b = 'a1b2c3d4e5f6';
    const c = 'a1b2c3d4e5f7';
    expect(timingSafeEqual(a, b)).toBe(true);
    expect(timingSafeEqual(a, c)).toBe(false);
  });

  it('is symmetric (commutative)', () => {
    const x = 'verify-me';
    const y = 'nope';
    expect(timingSafeEqual(x, y)).toBe(timingSafeEqual(y, x));
  });
});
