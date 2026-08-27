/**
 * @module services/inbound_webhook
 * @description Generic HMAC webhook signature verifier + provider-specific
 * envelope helpers. Pure zero-I/O (Web Crypto for HMAC). Never throws —
 * all failures are returned as structured {@link VerifyResult}.
 *
 * Supported providers:
 * - `stripe` — format `t={ts},v1={hex}` HMAC-SHA256(`{ts}.{rawBody}`)
 * - `github` — format `sha256={hex}` HMAC-SHA256(rawBody)
 * - `listmonk` / `ses` — plain HMAC-SHA256 (generic path)
 * - `generic` — plain HMAC-SHA256 convenience alias
 *
 * @packageDocumentation
 */

import { timingSafeEqual } from '../lib/timing_safe_equal.js';

/** Supported webhook providers and their signature schemes. */
export type WebhookProvider = 'stripe' | 'listmonk' | 'ses' | 'github' | 'generic';

/**
 * Inbound webhook signature header — the raw request material for verification.
 */
export interface WebhookHeader {
  readonly provider: WebhookProvider;
  /** Raw signature header value from the request. */
  readonly signature: string;
  /** Raw request body as received (before JSON.parse). */
  readonly rawBody: string;
  /** The secret/key used for verification. */
  readonly secret: string;
}

/**
 * Verification outcome. `valid` is true only when the signature matches
 * under the provider's scheme. `reason` explains failures and is null on success.
 */
export interface VerifyResult {
  readonly reason: string | null;
  readonly valid: boolean;
}

const encoder = new TextEncoder();

/**
 * HMAC-SHA256 helper. Pure async wrapper around Web Crypto.
 *
 * @param secret - The HMAC key (raw string; UTF-8 encoded internally).
 * @param data - Payload to sign.
 * @returns Hex-encoded HMAC digest (lowercase).
 */
async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
}

/**
 * Verify a webhook signature using the provider's expected scheme.
 *
 * Provider-specific logic:
 * - **stripe**: parses `t={ts},v1={hex}` from the header, computes
 *   HMAC-SHA256(`{ts}.{rawBody}`) with the signing secret (prefixed by
 *   the webhook secret key), and constant-time compares against the first
 *   `v1` entry.
 * - **github**: parses `sha256={hex}` from the header, computes
 *   HMAC-SHA256(rawBody), constant-time compares.
 * - **listmonk / ses / generic**: plain HMAC-SHA256(rawBody)
 *   against the secret, constant-time compares.
 *
 * @param input - Webhook header + body material.
 * @returns Verification result — never throws.
 *
 * @example
 * const result = await verifyWebhook({
 *   provider: 'stripe',
 *   signature: 't=1234567890,v1=deadbeef...',
 *   rawBody: '{"id":"evt_1"}',
 *   secret: 'whsec_abc123',
 * });
 * // → { valid: true, reason: null }
 */
export async function verifyWebhook(input: WebhookHeader): Promise<VerifyResult> {
  const { provider, rawBody, secret, signature } = input;

  if (!signature) {
    return { reason: 'missing signature', valid: false };
  }
  if (!secret) {
    return { reason: 'secret not configured', valid: false };
  }

  switch (provider) {
    case 'stripe': {
      const parsed = extractStripeSignature(signature);
      if (!parsed) {
        return { reason: 'invalid stripe signature format', valid: false };
      }

      const signedPayload = `${parsed.timestamp}.${rawBody}`;
      const expectedSig = await hmacSha256(secret, signedPayload);
      const matchFound = parsed.signatures.some((v1) => timingSafeEqual(v1, expectedSig));
      if (!matchFound) {
        return { reason: 'signature mismatch', valid: false };
      }
      return { reason: null, valid: true };
    }

    case 'github': {
      const sigHex = extractGitHubSignature(signature);
      if (!sigHex) {
        return { reason: 'invalid github signature format', valid: false };
      }
      const expectedSig = await hmacSha256(secret, rawBody);
      if (!timingSafeEqual(sigHex, expectedSig)) {
        return { reason: 'signature mismatch', valid: false };
      }
      return { reason: null, valid: true };
    }

    case 'listmonk':
    case 'ses':
    case 'generic': {
      const expectedSig = await hmacSha256(secret, rawBody);
      if (!timingSafeEqual(signature, expectedSig)) {
        return { reason: 'signature mismatch', valid: false };
      }
      return { reason: null, valid: true };
    }

    default:
      return { reason: `unknown provider: ${provider}`, valid: false };
  }
}

/**
 * Parse a Stripe webhook signature header (`t={ts},v1={sig1},v1={sig2}…`).
 * Returns null when `t=` or `v1=` is absent or malformed.
 *
 * @param header - Raw `Stripe-Signature` header value.
 * @returns Parsed timestamp + signature list, or null on parse failure.
 *
 * @example
 * extractStripeSignature('t=1234567890,v1=deadbeef,v1=cafebabe');
 * // → { timestamp: '1234567890', signatures: ['deadbeef', 'cafebabe'] }
 *
 * extractStripeSignature(''); // → null
 */
export function extractStripeSignature(
  header: string,
): { timestamp: string; signatures: string[] } | null {
  const pairs = header.split(',').map((p) => p.trim());
  let timestamp: string | undefined;
  const signatures: string[] = [];

  for (const pair of pairs) {
    if (pair.startsWith('t=')) {
      timestamp = pair.slice(2);
    } else if (pair.startsWith('v1=')) {
      signatures.push(pair.slice(3));
    }
  }

  if (!timestamp || signatures.length === 0) {
    return null;
  }
  return { signatures, timestamp };
}

/**
 * Extract the hex signature from a GitHub webhook `X-Hub-Signature-256`
 * header (`sha256={hex}`).
 *
 * Returns null when the header doesn't start with `sha256=` or is empty.
 *
 * @param header - Raw `X-Hub-Signature-256` header value.
 * @returns Hex string (without `sha256=` prefix), or null.
 *
 * @example
 * extractGitHubSignature('sha256=abc123def456');
 * // → 'abc123def456'
 *
 * extractGitHubSignature(''); // → null
 */
export function extractGitHubSignature(header: string): string | null {
  if (!header.startsWith('sha256=')) {
    return null;
  }
  const hex = header.slice(7);
  return hex || null;
}
