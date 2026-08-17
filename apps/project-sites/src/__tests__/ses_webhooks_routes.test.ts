/**
 * §42/ADR-0019 — POST /webhooks/ses (suppression-pipeline layer 3). HMAC-verified
 * (timing-safe) so nobody can suppress arbitrary addresses; SubscriptionConfirmation
 * auto-confirms only SNS-hosted URLs (SSRF guard); a Notification routes through
 * parseSesNotification → recordSuppressions. recordSuppressions is mocked.
 */
jest.mock('../services/email_suppressions.js', () => ({
  recordSuppressions: jest.fn(async () => ({ suppressed: 1, failed: 0 })),
}));

import { Hono } from 'hono';
import { hmacSha256 } from '@project-sites/shared';
import { sesWebhooks } from '../routes/ses_webhooks.js';
import { recordSuppressions } from '../services/email_suppressions.js';
import type { Env, Variables } from '../types/env.js';

const mockRecord = recordSuppressions as jest.MockedFunction<typeof recordSuppressions>;
const SECRET = 'whsec_test_secret';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.route('/', sesWebhooks);

function makeEnv(over: Record<string, unknown> = {}): Env {
  return { SES_WEBHOOK_SECRET: SECRET, DB: {} as unknown, ...over } as unknown as Env;
}

async function post(body: string, opts: { sig?: string; env?: Env } = {}) {
  const sig = opts.sig ?? (await hmacSha256(SECRET, body));
  return app.request(
    '/webhooks/ses',
    {
      method: 'POST',
      headers: { 'x-hookdeck-signature': sig, 'content-type': 'application/json' },
      body,
    },
    opts.env ?? makeEnv(),
  );
}

const permanentBounce = JSON.stringify({
  notificationType: 'Bounce',
  bounce: {
    bounceType: 'Permanent',
    bouncedRecipients: [{ emailAddress: 'gone@example.com' }],
  },
  mail: { messageId: 'm1' },
});

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('POST /webhooks/ses', () => {
  it('returns 503 when SES_WEBHOOK_SECRET is not configured', async () => {
    const res = await post(permanentBounce, { env: makeEnv({ SES_WEBHOOK_SECRET: undefined }) });
    expect(res.status).toBe(503);
  });

  it('rejects an invalid HMAC signature with 401 (no suppression)', async () => {
    const res = await post(permanentBounce, { sig: 'deadbeef' });
    expect(res.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('records suppressions for a verified permanent-bounce notification', async () => {
    const res = await post(permanentBounce);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', parsed: 1, suppressed: 1 });
    expect(mockRecord).toHaveBeenCalledTimes(1);
    // The parsed suppression (lowercased gone@example.com) reached the store.
    expect(mockRecord.mock.calls[0][1]).toEqual([
      expect.objectContaining({ email: 'gone@example.com', reason: 'bounce' }),
    ]);
  });

  it('auto-confirms an SNS subscription handshake (SNS-hosted URL only)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const body = JSON.stringify({
      Type: 'SubscriptionConfirmation',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc',
    });
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'subscription_confirmed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to fetch a non-SNS SubscribeURL (SSRF guard)', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const body = JSON.stringify({
      Type: 'SubscriptionConfirmation',
      SubscribeURL: 'https://evil.example.com/confirm',
    });
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 500 when a suppression write is DROPPED, so SNS retries (never acks a lost suppression)', async () => {
    // recordSuppressions reports a dropped compliance-critical write (D1 outage).
    mockRecord.mockResolvedValueOnce({ suppressed: 0, failed: 1 });
    const res = await post(permanentBounce);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ status: 'partial_failure', failed: 1 });
  });

  it('returns 200 with zero suppressions for a delivery notification', async () => {
    const res = await post(
      JSON.stringify({ notificationType: 'Delivery', mail: { messageId: 'm2' } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', parsed: 0, suppressed: 0 });
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
