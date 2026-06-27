/**
 * POST /webhooks/livekit (voice-architecture ADR, LiveKit amendment). The route
 * verifies LiveKit's HS256 JWT (signature + `iss` + body `sha256` claim), is
 * idempotent on the event id, and is dark (404) until creds are set. The
 * webhook_events idempotency helpers are mocked.
 */
jest.mock('../services/webhook.js', () => ({
  checkWebhookIdempotency: jest.fn(async () => ({ isDuplicate: false })),
  storeWebhookEvent: jest.fn(async () => ({ id: 'we_livekit_1', error: null })),
  markWebhookProcessed: jest.fn(async () => {}),
}));

import { Hono } from 'hono';
import { signHs256 } from '../lib/jwt.js';
import { livekitWebhookRoutes } from '../routes/livekit_webhooks.js';
import {
  checkWebhookIdempotency,
  storeWebhookEvent,
} from '../services/webhook.js';
import type { Env, Variables } from '../types/env.js';

const mockDupe = checkWebhookIdempotency as jest.MockedFunction<typeof checkWebhookIdempotency>;
const mockStore = storeWebhookEvent as jest.MockedFunction<typeof storeWebhookEvent>;

const API_KEY = 'APItestkey123';
const API_SECRET = 'livekit-test-secret-0123456789';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.route('/', livekitWebhookRoutes);

function makeEnv(over: Record<string, unknown> = {}): Env {
  return {
    LIVEKIT_API_KEY: API_KEY,
    LIVEKIT_API_SECRET: API_SECRET,
    DB: {} as unknown,
    ...over,
  } as unknown as Env;
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const EVENT = JSON.stringify({
  event: 'room_finished',
  id: 'EV_room_finished_1',
  room: { name: 'call-vitos-salon', sid: 'RM_1' },
});

async function post(
  body: string,
  opts: { token?: string; secret?: string; iss?: string; sha256?: string; noAuth?: boolean; env?: Env } = {},
) {
  const hash = opts.sha256 ?? (await sha256Base64(body));
  const token =
    opts.token ??
    (await signHs256({ iss: opts.iss ?? API_KEY, sha256: hash }, opts.secret ?? API_SECRET, 600));
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!opts.noAuth) headers['authorization'] = token;
  return app.request('/webhooks/livekit', { method: 'POST', headers, body }, opts.env ?? makeEnv());
}

afterEach(() => jest.clearAllMocks());

describe('POST /webhooks/livekit', () => {
  it('accepts a correctly signed event and stores it', async () => {
    const res = await post(EVENT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(mockStore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: 'livekit', event_id: 'EV_room_finished_1', event_type: 'room_finished' }),
    );
  });

  it('returns 404 (dark) when LiveKit creds are unset', async () => {
    const res = await post(EVENT, { env: makeEnv({ LIVEKIT_API_KEY: undefined, LIVEKIT_API_SECRET: undefined }) });
    expect(res.status).toBe(404);
    expect(mockStore).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header with 403', async () => {
    const res = await post(EVENT, { noAuth: true });
    expect(res.status).toBe(403);
    expect(mockStore).not.toHaveBeenCalled();
  });

  it('rejects a token signed with the wrong secret with 403', async () => {
    const res = await post(EVENT, { secret: 'wrong-secret' });
    expect(res.status).toBe(403);
  });

  it('rejects an issuer mismatch with 403', async () => {
    const res = await post(EVENT, { iss: 'APInotours' });
    expect(res.status).toBe(403);
  });

  it('rejects a body-hash mismatch (tampered body) with 403', async () => {
    // Valid signature, but the sha256 claim does not match the actual body.
    const res = await post(EVENT, { sha256: await sha256Base64('{"event":"different"}') });
    expect(res.status).toBe(403);
    expect(mockStore).not.toHaveBeenCalled();
  });

  it('acks a duplicate event without re-storing', async () => {
    mockDupe.mockResolvedValueOnce({ isDuplicate: true, existingId: 'we_prev' });
    const res = await post(EVENT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(mockStore).not.toHaveBeenCalled();
  });
});
