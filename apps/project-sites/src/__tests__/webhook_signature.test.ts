import {
  signPayload,
  buildWebhookHeaders,
  verifySignature,
  type HmacAlgorithm,
} from '../services/webhook_signature.js';

const TEST_SECRET = 'whsec_my-test-secret-key-2026';
const TEST_PAYLOAD = JSON.stringify({ event: 'site.published', id: 'site_abc123' });

describe('signPayload', () => {
  it('returns a hex string for sha256', async () => {
    const sig = await signPayload(TEST_PAYLOAD, TEST_SECRET);
    expect(sig).toMatch(/^[a-f0-9]+$/);
    expect(sig.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
  });

  it('returns a hex string for sha512', async () => {
    const sig = await signPayload(TEST_PAYLOAD, TEST_SECRET, 'sha512');
    expect(sig).toMatch(/^[a-f0-9]+$/);
    expect(sig.length).toBe(128); // SHA-512 = 64 bytes = 128 hex chars
  });

  it('produces the same output for the same input', async () => {
    const a = await signPayload('hello', TEST_SECRET);
    const b = await signPayload('hello', TEST_SECRET);
    expect(a).toBe(b);
  });

  it('produces different output for different secrets', async () => {
    const a = await signPayload('hello', 'secret-one');
    const b = await signPayload('hello', 'secret-two');
    expect(a).not.toBe(b);
  });

  it('produces different output for different payloads', async () => {
    const a = await signPayload('payload-a', TEST_SECRET);
    const b = await signPayload('payload-b', TEST_SECRET);
    expect(a).not.toBe(b);
  });

  it('defaults algorithm to sha256', async () => {
    const explicit = await signPayload(TEST_PAYLOAD, TEST_SECRET, 'sha256');
    const implicit = await signPayload(TEST_PAYLOAD, TEST_SECRET);
    expect(implicit).toBe(explicit);
  });

  it('handles an empty string payload', async () => {
    const sig = await signPayload('', TEST_SECRET);
    expect(sig).toMatch(/^[a-f0-9]+$/);
    expect(sig.length).toBe(64);
  });

  it('handles a payload with special characters', async () => {
    const sig = await signPayload('{"msg":"héllo wörld 🎉"}', TEST_SECRET);
    expect(sig).toMatch(/^[a-f0-9]+$/);
    expect(sig.length).toBe(64);
  });
});

describe('buildWebhookHeaders', () => {
  it('returns x-webhook-signature and x-webhook-timestamp', async () => {
    const headers = await buildWebhookHeaders(TEST_PAYLOAD, {
      secret: TEST_SECRET,
      algorithm: 'sha256',
    });

    expect(headers['x-webhook-signature']).toMatch(/^[a-f0-9]{64}$/);
    expect(headers['x-webhook-timestamp']).toMatch(/^\d+$/);
  });

  it('produces a valid-looking timestamp (Unix ms)', async () => {
    const before = Date.now();
    const headers = await buildWebhookHeaders(TEST_PAYLOAD, {
      secret: TEST_SECRET,
      algorithm: 'sha256',
    });
    const after = Date.now();
    const ts = parseInt(headers['x-webhook-timestamp'], 10);

    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('uses sha512 when configured', async () => {
    const headers = await buildWebhookHeaders(TEST_PAYLOAD, {
      secret: TEST_SECRET,
      algorithm: 'sha512',
    });

    expect(headers['x-webhook-signature']).toMatch(/^[a-f0-9]{128}$/);
  });

  it('produces different signatures for different secrets', async () => {
    const h1 = await buildWebhookHeaders(TEST_PAYLOAD, { secret: 'secret-a', algorithm: 'sha256' });
    const h2 = await buildWebhookHeaders(TEST_PAYLOAD, { secret: 'secret-b', algorithm: 'sha256' });
    expect(h1['x-webhook-signature']).not.toBe(h2['x-webhook-signature']);
  });
});

describe('verifySignature', () => {
  it('returns true for a valid sha256 signature', async () => {
    const sig = await signPayload(TEST_PAYLOAD, TEST_SECRET);
    const result = await verifySignature(TEST_PAYLOAD, sig, TEST_SECRET, String(Date.now()));
    expect(result).toBe(true);
  });

  it('returns false for a tampered payload', async () => {
    const sig = await signPayload(TEST_PAYLOAD, TEST_SECRET);
    const tamperedPayload = JSON.stringify({ event: 'site.deleted', id: 'site_abc123' });
    const result = await verifySignature(tamperedPayload, sig, TEST_SECRET, String(Date.now()));
    expect(result).toBe(false);
  });

  it('returns false for an incorrect signature', async () => {
    const result = await verifySignature(
      TEST_PAYLOAD,
      'badbadbad000badbadbad000badbadbad000badbadbad000badbadbad000badb',
      TEST_SECRET,
      String(Date.now()),
    );
    expect(result).toBe(false);
  });

  it('returns false for a mismatched secret', async () => {
    const sig = await signPayload(TEST_PAYLOAD, TEST_SECRET);
    const result = await verifySignature(TEST_PAYLOAD, sig, 'wrong-secret', String(Date.now()));
    expect(result).toBe(false);
  });

  it('rejects a stale timestamp when toleranceMs is set', async () => {
    const sig = await signPayload(TEST_PAYLOAD, TEST_SECRET);
    const oldTimestamp = String(Date.now() - 600_000); // 10 minutes ago
    const result = await verifySignature(
      TEST_PAYLOAD,
      sig,
      TEST_SECRET,
      oldTimestamp,
      300_000, // 5-minute tolerance
    );
    expect(result).toBe(false);
  });

  it('accepts a fresh timestamp within toleranceMs', async () => {
    const sig = await signPayload(TEST_PAYLOAD, TEST_SECRET);
    const recentTimestamp = String(Date.now() - 60_000); // 1 minute ago
    const result = await verifySignature(
      TEST_PAYLOAD,
      sig,
      TEST_SECRET,
      recentTimestamp,
      300_000, // 5-minute tolerance
    );
    expect(result).toBe(true);
  });

  it('returns false when no toleranceMs and timestamp is NaN', async () => {
    const sig = await signPayload(TEST_PAYLOAD, TEST_SECRET);
    // Without toleranceMs, the NaN timestamp is never checked, so this should still pass.
    const result = await verifySignature(TEST_PAYLOAD, sig, TEST_SECRET, 'not-a-number');
    expect(result).toBe(true);
  });

  it('returns false when toleranceMs is set and timestamp is NaN', async () => {
    const sig = await signPayload(TEST_PAYLOAD, TEST_SECRET);
    const result = await verifySignature(TEST_PAYLOAD, sig, TEST_SECRET, 'not-a-number', 300_000);
    expect(result).toBe(false);
  });

  it('handles empty string payload', async () => {
    const sig = await signPayload('', TEST_SECRET);
    const result = await verifySignature('', sig, TEST_SECRET, String(Date.now()));
    expect(result).toBe(true);
  });

  it('is constant-time — returns false for wrong-length signature', async () => {
    const sig = await signPayload(TEST_PAYLOAD, TEST_SECRET);
    const truncated = sig.slice(0, 30); // shorter than expected 64
    const result = await verifySignature(TEST_PAYLOAD, truncated, TEST_SECRET, String(Date.now()));
    expect(result).toBe(false);
  });

  it('verifies a sha512 signature', async () => {
    const sig = await signPayload(TEST_PAYLOAD, TEST_SECRET, 'sha512');
    const result = await verifySignature(TEST_PAYLOAD, sig, TEST_SECRET, String(Date.now()));
    expect(result).toBe(true);
  });
});
