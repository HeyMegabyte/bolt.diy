import {
  signedPayloadBase,
  buildSignatureHeader,
  nextRetryDelayMs,
  isDeliverySuccess,
  shouldRetry,
  validateEndpointInput,
  maskSecret,
  createWebhookEndpoint,
  listWebhookEndpoints,
  deleteWebhookEndpoint,
  MAX_DELIVERY_ATTEMPTS,
  BASE_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
} from '../services/outbound_webhooks.js';
import type { Env } from '../types/env.js';

/** Mock env with a valid 32-byte AES key so ai_crypto.encrypt round-trips, + a mock D1. */
function mockEnv(rows: Record<string, unknown>[], changes: number, captured: unknown[][] = []): Env {
  return {
    MCP_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32)).toString('base64'),
    DB: {
      prepare: (_sql: string) => ({
        bind: (...args: unknown[]) => ({
          all: async () => ({ results: rows }),
          run: async () => {
            captured.push(args);
            return { meta: { changes } };
          },
        }),
      }),
    },
  } as unknown as Env;
}

describe('outbound_webhooks signed payload', () => {
  it('binds the timestamp into the signed material (replay-safety)', () => {
    expect(signedPayloadBase('1700000000', '{"a":1}')).toBe('1700000000.{"a":1}');
  });

  it('formats the signature header Svix/Stripe-style', () => {
    expect(buildSignatureHeader('1700000000', 'abc123')).toBe('t=1700000000,v1=abc123');
  });
});

describe('outbound_webhooks retry schedule', () => {
  it('doubles the delay each attempt', () => {
    expect(nextRetryDelayMs(1)).toBe(BASE_RETRY_DELAY_MS);
    expect(nextRetryDelayMs(2)).toBe(BASE_RETRY_DELAY_MS * 2);
    expect(nextRetryDelayMs(3)).toBe(BASE_RETRY_DELAY_MS * 4);
    expect(nextRetryDelayMs(4)).toBe(BASE_RETRY_DELAY_MS * 8);
  });

  it('caps the delay at MAX_RETRY_DELAY_MS', () => {
    expect(nextRetryDelayMs(50)).toBe(MAX_RETRY_DELAY_MS);
  });
});

describe('outbound_webhooks delivery outcome', () => {
  it('treats 2xx as success', () => {
    expect(isDeliverySuccess(200)).toBe(true);
    expect(isDeliverySuccess(204)).toBe(true);
    expect(isDeliverySuccess(299)).toBe(true);
    expect(isDeliverySuccess(300)).toBe(false);
    expect(isDeliverySuccess(500)).toBe(false);
  });
});

describe('outbound_webhooks shouldRetry', () => {
  it('retries transient failures (network, 429, 5xx) within the attempt budget', () => {
    expect(shouldRetry(1, 0)).toBe(true); // network error
    expect(shouldRetry(1, 429)).toBe(true); // rate limited
    expect(shouldRetry(1, 500)).toBe(true);
    expect(shouldRetry(1, 503)).toBe(true);
  });

  it('never retries a delivered (2xx) response', () => {
    expect(shouldRetry(1, 200)).toBe(false);
    expect(shouldRetry(1, 204)).toBe(false);
  });

  it('never retries a permanent (non-429) 4xx', () => {
    expect(shouldRetry(1, 400)).toBe(false);
    expect(shouldRetry(1, 401)).toBe(false);
    expect(shouldRetry(1, 404)).toBe(false);
  });

  it('stops once the attempt budget is exhausted', () => {
    expect(shouldRetry(MAX_DELIVERY_ATTEMPTS, 500)).toBe(false);
    expect(shouldRetry(MAX_DELIVERY_ATTEMPTS - 1, 500)).toBe(true);
  });
});

describe('validateEndpointInput', () => {
  it('accepts an https url subscribed to allowlisted events', () => {
    expect(validateEndpointInput('https://hooks.example.com/x', ['site.published'])).toEqual({ ok: true, errors: [] });
  });

  it('rejects a non-https url', () => {
    const r = validateEndpointInput('http://hooks.example.com', ['site.published']);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('https'))).toBe(true);
  });

  it('rejects an invalid url', () => {
    expect(validateEndpointInput('not a url', ['site.published']).ok).toBe(false);
  });

  it('requires at least one event and rejects unknown ones', () => {
    expect(validateEndpointInput('https://x.com', []).ok).toBe(false);
    const r = validateEndpointInput('https://x.com', ['site.published', 'bogus.event']);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('Unknown event'))).toBe(true);
  });
});

describe('maskSecret', () => {
  it('shows only the last 4 chars', () => {
    expect(maskSecret('whsec_abcd1234')).toBe('••••1234');
    expect(maskSecret('xy')).toBe('••••');
  });
});

describe('createWebhookEndpoint', () => {
  it('encrypts the secret and inserts; returns the plaintext secret once', async () => {
    const captured: unknown[][] = [];
    const res = await createWebhookEndpoint(mockEnv([], 1, captured), 'o1', 's1', 'https://hooks.example.com/x', ['site.published']);
    expect(res.ok).toBe(true);
    expect(res.secret).toMatch(/^whsec_/);
    // bind: [id, site_id, org_id, url, secret_encrypted, event_types]
    expect(captured[0]?.[2]).toBe('o1');
    expect(captured[0]?.[3]).toBe('https://hooks.example.com/x');
    expect(captured[0]?.[4]).not.toBe(res.secret); // stored value is the AES blob, not the plaintext
    expect(JSON.parse(captured[0]?.[5] as string)).toEqual(['site.published']);
  });

  it('rejects an invalid subscription without inserting', async () => {
    const captured: unknown[][] = [];
    const res = await createWebhookEndpoint(mockEnv([], 1, captured), 'o1', 's1', 'http://insecure', ['site.published']);
    expect(res.ok).toBe(false);
    expect(captured.length).toBe(0);
  });
});

describe('listWebhookEndpoints', () => {
  it('parses event_types and never returns a secret', async () => {
    const env = mockEnv([{ id: 'e1', url: 'https://x.com', event_types: '["form.submitted"]', enabled: 1 }], 0);
    const list = await listWebhookEndpoints(env, 'o1', 's1');
    expect(list).toEqual([{ id: 'e1', url: 'https://x.com', eventTypes: ['form.submitted'], enabled: true }]);
    expect(JSON.stringify(list)).not.toContain('secret');
  });
});

describe('deleteWebhookEndpoint', () => {
  it('reports ok/not-ok by rows changed', async () => {
    expect(await deleteWebhookEndpoint(mockEnv([], 1), 'o1', 's1', 'e1')).toEqual({ ok: true });
    expect(await deleteWebhookEndpoint(mockEnv([], 0), 'o1', 's1', 'missing')).toEqual({ ok: false });
  });
});
