/**
 * Route coverage for the Twilio voice/SMS webhook surface (convergence r36).
 *
 * Exercises {@link voiceWebhookRoutes} end-to-end through a real Hono app,
 * mocking only the boundaries: Twilio signature/recording helpers, the voice
 * orchestrator, and the D1 query helpers. Covers every handler:
 *   - inbound voice call    (valid + invalid Twilio signature, TwiML shape)
 *   - media-stream upgrade   (delegation)
 *   - call-status callback   (signature gate + idempotent persistence)
 *   - recording-ready        (signature gate + missing params + unknown call)
 *   - inbound SMS            (signature gate + TwiML)
 *   - sms-status callback    (signature gate + persistence)
 *   - internal recording-saved (HMAC: not-configured 500, bad sig 401,
 *                                bad JSON 400, missing fields 400, success)
 */

jest.mock('../services/twilio.js', () => ({
  validateSignature: jest.fn(),
  fetchRecording: jest.fn(),
  downloadRecordingBytes: jest.fn(),
}));

jest.mock('../services/voice_orchestrator.js', () => ({
  handleInboundCall: jest.fn(),
  handleInboundSms: jest.fn(),
  handleMediaStream: jest.fn(),
}));

jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn(),
  dbUpdate: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { voiceWebhookRoutes } from '../routes/voice_webhooks.js';
import { validateSignature, fetchRecording, downloadRecordingBytes } from '../services/twilio.js';
import {
  handleInboundCall,
  handleInboundSms,
  handleMediaStream,
} from '../services/voice_orchestrator.js';
import { dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';

const mockValidateSignature = validateSignature as unknown as jest.Mock;
const mockFetchRecording = fetchRecording as unknown as jest.Mock;
const mockDownloadRecordingBytes = downloadRecordingBytes as unknown as jest.Mock;
const mockHandleInboundCall = handleInboundCall as unknown as jest.Mock;
const mockHandleInboundSms = handleInboundSms as unknown as jest.Mock;
const mockHandleMediaStream = handleMediaStream as unknown as jest.Mock;
const mockDbQueryOne = dbQueryOne as unknown as jest.Mock;
const mockDbInsert = dbInsert as unknown as jest.Mock;
const mockDbUpdate = dbUpdate as unknown as jest.Mock;

// ─── Boundary helpers ─────────────────────────────────────────────────────────

/** In-memory R2 bucket mock — captures `put(...)` calls. */
function makeBucket() {
  return { put: jest.fn(async () => undefined) };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    SITES_BUCKET: makeBucket(),
    INTERNAL_BUILD_SECRET: 'internal-secret',
    ...overrides,
  } as unknown as Env;
}

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/', voiceWebhookRoutes);
  return app;
}

/** POST `application/x-www-form-urlencoded` (mirrors how Twilio calls). */
function postForm(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  params: Record<string, string>,
  env: Env,
  headers: Record<string, string> = {},
) {
  const body = new URLSearchParams(params).toString();
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', host: 'projectsites.dev', ...headers },
      body,
    },
    env,
  );
}

/** Compute the same HMAC-SHA256 hex signature the internal route expects. */
async function hmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const SIG = { 'x-twilio-signature': 'sig-abc' };

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Inbound voice call ────────────────────────────────────────────────────────

describe('POST /webhooks/voice/inbound', () => {
  it('returns 403 when the Twilio signature is invalid', async () => {
    mockValidateSignature.mockResolvedValue(false);
    const res = await postForm(makeApp(), '/webhooks/voice/inbound', { CallSid: 'CA1' }, makeEnv(), SIG);
    expect(res.status).toBe(403);
    expect(mockHandleInboundCall).not.toHaveBeenCalled();
  });

  it('returns 403 when the signature header is missing', async () => {
    // requireTwilioSignature short-circuits on missing header without calling validateSignature.
    const res = await postForm(makeApp(), '/webhooks/voice/inbound', { CallSid: 'CA1' }, makeEnv());
    expect(res.status).toBe(403);
    expect(mockValidateSignature).not.toHaveBeenCalled();
  });

  it('returns the orchestrator TwiML with xml content-type on a valid signature', async () => {
    mockValidateSignature.mockResolvedValue(true);
    mockHandleInboundCall.mockResolvedValue('<Response><Say>Hi</Say></Response>');
    const res = await postForm(
      makeApp(),
      '/webhooks/voice/inbound',
      { CallSid: 'CA1', From: '+15551112222', To: '+15553334444', AccountSid: 'AC1', Direction: 'inbound' },
      makeEnv(),
      SIG,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/xml');
    expect(await res.text()).toContain('<Say>Hi</Say>');
    // Form params + host are forwarded to the orchestrator.
    expect(mockHandleInboundCall).toHaveBeenCalledTimes(1);
    expect(mockHandleInboundCall.mock.calls[0][1]).toMatchObject({ CallSid: 'CA1', From: '+15551112222' });
    expect(mockHandleInboundCall.mock.calls[0][2]).toBe('projectsites.dev');
  });
});

// ─── Media stream upgrade ───────────────────────────────────────────────────────

describe('GET /webhooks/voice/stream', () => {
  it('delegates to handleMediaStream and returns its response', async () => {
    mockHandleMediaStream.mockResolvedValue(new Response('upgraded', { status: 200 }));
    const res = await makeApp().request('/webhooks/voice/stream', { method: 'GET' }, makeEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('upgraded');
    expect(mockHandleMediaStream).toHaveBeenCalledTimes(1);
  });
});

// ─── Call status callback ───────────────────────────────────────────────────────

describe('POST /webhooks/voice/status', () => {
  it('returns 403 when the signature is invalid', async () => {
    mockValidateSignature.mockResolvedValue(false);
    const res = await postForm(makeApp(), '/webhooks/voice/status', { CallSid: 'CA1' }, makeEnv(), SIG);
    expect(res.status).toBe(403);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('persists status + duration and sets ended_at on completed', async () => {
    mockValidateSignature.mockResolvedValue(true);
    mockDbUpdate.mockResolvedValue(undefined);
    const res = await postForm(
      makeApp(),
      '/webhooks/voice/status',
      { CallSid: 'CA9', CallStatus: 'completed', CallDuration: '42' },
      makeEnv(),
      SIG,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<Response/>');
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    const [, , updates, where, params] = mockDbUpdate.mock.calls[0];
    expect(updates).toMatchObject({ status: 'completed', duration_seconds: 42 });
    expect(updates.ended_at).toEqual(expect.any(String));
    expect(where).toBe('twilio_call_sid = ?');
    expect(params).toEqual(['CA9']);
  });

  it('omits ended_at + nulls duration for a non-terminal status', async () => {
    mockValidateSignature.mockResolvedValue(true);
    mockDbUpdate.mockResolvedValue(undefined);
    await postForm(makeApp(), '/webhooks/voice/status', { CallSid: 'CA9', CallStatus: 'ringing' }, makeEnv(), SIG);
    const updates = mockDbUpdate.mock.calls[0][2];
    expect(updates.status).toBe('ringing');
    expect(updates.duration_seconds).toBeNull();
    expect(updates).not.toHaveProperty('ended_at');
  });

  it('skips the DB write when CallSid is absent but still returns 200', async () => {
    mockValidateSignature.mockResolvedValue(true);
    const res = await postForm(makeApp(), '/webhooks/voice/status', { CallStatus: 'completed' }, makeEnv(), SIG);
    expect(res.status).toBe(200);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('swallows a DB failure and still returns 200 TwiML (idempotent-safe)', async () => {
    mockValidateSignature.mockResolvedValue(true);
    mockDbUpdate.mockRejectedValue(new Error('D1 down'));
    const res = await postForm(makeApp(), '/webhooks/voice/status', { CallSid: 'CA9', CallStatus: 'busy' }, makeEnv(), SIG);
    expect(res.status).toBe(200);
  });
});

// ─── Recording-ready callback ───────────────────────────────────────────────────

describe('POST /webhooks/voice/recording-ready', () => {
  it('returns 403 when the signature is invalid', async () => {
    mockValidateSignature.mockResolvedValue(false);
    const res = await postForm(
      makeApp(),
      '/webhooks/voice/recording-ready',
      { RecordingSid: 'RE1', CallSid: 'CA1' },
      makeEnv(),
      SIG,
    );
    expect(res.status).toBe(403);
  });

  it('returns 200 (no-op) when RecordingSid or CallSid is missing', async () => {
    mockValidateSignature.mockResolvedValue(true);
    const res = await postForm(makeApp(), '/webhooks/voice/recording-ready', { CallSid: 'CA1' }, makeEnv(), SIG);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<Response/>');
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('returns 200 (no-op) when the call row is not found', async () => {
    mockValidateSignature.mockResolvedValue(true);
    mockDbQueryOne.mockResolvedValue(null);
    const res = await postForm(
      makeApp(),
      '/webhooks/voice/recording-ready',
      { RecordingSid: 'RE1', CallSid: 'CA-unknown' },
      makeEnv(),
      SIG,
    );
    expect(res.status).toBe(200);
    expect(mockDbQueryOne).toHaveBeenCalledTimes(1);
    expect(mockFetchRecording).not.toHaveBeenCalled();
  });

  it('returns TwiML immediately and persists the recording to R2 + D1 out-of-band', async () => {
    mockValidateSignature.mockResolvedValue(true);
    mockDbQueryOne.mockResolvedValue({ id: 'call-1', site_id: 'site-1' });
    mockFetchRecording.mockResolvedValue({ sid: 'RE1', duration: 30, channels: 1, download_url: 'https://api.twilio/x.mp3' });
    mockDownloadRecordingBytes.mockResolvedValue({ bytes: new ArrayBuffer(8), mime: 'audio/mpeg' });
    mockDbInsert.mockResolvedValue(undefined);
    mockDbUpdate.mockResolvedValue(undefined);

    const env = makeEnv();
    const res = await postForm(
      makeApp(),
      '/webhooks/voice/recording-ready',
      { RecordingSid: 'RE1', CallSid: 'CA1' },
      env,
      SIG,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<Response/>');

    // The persistence runs in a fire-and-forget IIFE; flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetchRecording).toHaveBeenCalledWith(expect.anything(), 'RE1');
    const bucket = env.SITES_BUCKET as unknown as { put: jest.Mock };
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(bucket.put.mock.calls[0][0]).toBe('voice/site-1/call-1/RE1.mp3');
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockDbInsert.mock.calls[0][1]).toBe('voice_recordings');
    expect(mockDbInsert.mock.calls[0][2]).toMatchObject({ call_id: 'call-1', kind: 'audio', r2_key: 'voice/site-1/call-1/RE1.mp3' });
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });

  it('still returns 200 when the out-of-band download throws (error is swallowed)', async () => {
    mockValidateSignature.mockResolvedValue(true);
    mockDbQueryOne.mockResolvedValue({ id: 'call-1', site_id: 'site-1' });
    mockFetchRecording.mockRejectedValue(new Error('twilio 502'));
    const res = await postForm(
      makeApp(),
      '/webhooks/voice/recording-ready',
      { RecordingSid: 'RE1', CallSid: 'CA1' },
      makeEnv(),
      SIG,
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});

// ─── Inbound SMS ────────────────────────────────────────────────────────────────

describe('POST /webhooks/sms/inbound', () => {
  it('returns 403 when the signature is invalid', async () => {
    mockValidateSignature.mockResolvedValue(false);
    const res = await postForm(makeApp(), '/webhooks/sms/inbound', { MessageSid: 'SM1' }, makeEnv(), SIG);
    expect(res.status).toBe(403);
    expect(mockHandleInboundSms).not.toHaveBeenCalled();
  });

  it('returns orchestrator TwiML with the forwarded SMS params on a valid signature', async () => {
    mockValidateSignature.mockResolvedValue(true);
    mockHandleInboundSms.mockResolvedValue('<Response><Message>ok</Message></Response>');
    const res = await postForm(
      makeApp(),
      '/webhooks/sms/inbound',
      { MessageSid: 'SM1', From: '+15551112222', To: '+15553334444', Body: 'hello', AccountSid: 'AC1', NumMedia: '0' },
      makeEnv(),
      SIG,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/xml');
    expect(await res.text()).toContain('<Message>ok</Message>');
    expect(mockHandleInboundSms.mock.calls[0][1]).toMatchObject({ MessageSid: 'SM1', Body: 'hello' });
  });
});

// ─── SMS status callback ────────────────────────────────────────────────────────

describe('POST /webhooks/sms/status', () => {
  it('returns 403 when the signature is invalid', async () => {
    mockValidateSignature.mockResolvedValue(false);
    const res = await postForm(makeApp(), '/webhooks/sms/status', { MessageSid: 'SM1' }, makeEnv(), SIG);
    expect(res.status).toBe(403);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('persists status + delivered_at on a delivered message', async () => {
    mockValidateSignature.mockResolvedValue(true);
    mockDbUpdate.mockResolvedValue(undefined);
    const res = await postForm(
      makeApp(),
      '/webhooks/sms/status',
      { MessageSid: 'SM9', MessageStatus: 'delivered' },
      makeEnv(),
      SIG,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<Response/>');
    const [, table, updates, where, params] = mockDbUpdate.mock.calls[0];
    expect(table).toBe('voice_messages');
    expect(updates.status).toBe('delivered');
    expect(updates.delivered_at).toEqual(expect.any(String));
    expect(where).toBe('twilio_message_sid = ?');
    expect(params).toEqual(['SM9']);
  });

  it('omits delivered_at for non-delivered statuses', async () => {
    mockValidateSignature.mockResolvedValue(true);
    mockDbUpdate.mockResolvedValue(undefined);
    await postForm(makeApp(), '/webhooks/sms/status', { MessageSid: 'SM9', MessageStatus: 'sent' }, makeEnv(), SIG);
    expect(mockDbUpdate.mock.calls[0][2]).not.toHaveProperty('delivered_at');
  });

  it('skips the DB write when MessageSid is absent', async () => {
    mockValidateSignature.mockResolvedValue(true);
    const res = await postForm(makeApp(), '/webhooks/sms/status', { MessageStatus: 'delivered' }, makeEnv(), SIG);
    expect(res.status).toBe(200);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});

// ─── Internal recording-saved (HMAC-signed browse-agent callback) ───────────────

describe('POST /internal/voice/recording-saved', () => {
  const PATH = '/internal/voice/recording-saved';
  const SECRET = 'internal-secret';

  it('returns 500 when INTERNAL_BUILD_SECRET is not configured', async () => {
    const env = makeEnv({ INTERNAL_BUILD_SECRET: '' });
    const res = await makeApp().request(
      PATH,
      { method: 'POST', headers: { 'x-internal-sig': 'x' }, body: '{}' },
      env,
    );
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain('not configured');
  });

  it('returns 401 when the HMAC signature does not match', async () => {
    const res = await makeApp().request(
      PATH,
      { method: 'POST', headers: { 'x-internal-sig': 'deadbeef' }, body: JSON.stringify({ callId: 'c1' }) },
      makeEnv(),
    );
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain('invalid signature');
  });

  it('returns 400 when the signed body is not valid JSON', async () => {
    const body = 'not-json';
    const sig = await hmacHex(SECRET, body);
    const res = await makeApp().request(
      PATH,
      { method: 'POST', headers: { 'x-internal-sig': sig }, body },
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain('bad json');
  });

  it('returns 400 when required fields are missing', async () => {
    const body = JSON.stringify({ kind: 'audio', r2Key: 'k' }); // no callId
    const sig = await hmacHex(SECRET, body);
    const res = await makeApp().request(
      PATH,
      { method: 'POST', headers: { 'x-internal-sig': sig }, body },
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain('missing fields');
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('inserts an audio recording on a valid signed payload', async () => {
    mockDbInsert.mockResolvedValue(undefined);
    const body = JSON.stringify({
      callId: 'call-7',
      kind: 'audio',
      r2Key: 'voice/site/call-7/x.mp3',
      mime: 'audio/mpeg',
      sizeBytes: 1234,
      durationSeconds: 12,
    });
    const sig = await hmacHex(SECRET, body);
    const res = await makeApp().request(
      PATH,
      { method: 'POST', headers: { 'x-internal-sig': sig }, body },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean };
    expect(json.ok).toBe(true);
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockDbInsert.mock.calls[0][1]).toBe('voice_recordings');
    expect(mockDbInsert.mock.calls[0][2]).toMatchObject({
      call_id: 'call-7',
      kind: 'audio',
      r2_key: 'voice/site/call-7/x.mp3',
      mime: 'audio/mpeg',
      size_bytes: 1234,
      duration_seconds: 12,
    });
    // No video → no extra voice_calls update.
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('also updates voice_calls with the video URL when kind is video', async () => {
    mockDbInsert.mockResolvedValue(undefined);
    mockDbUpdate.mockResolvedValue(undefined);
    const body = JSON.stringify({ callId: 'call-8', kind: 'video', r2Key: 'voice/site/call-8/v.mp4' });
    const sig = await hmacHex(SECRET, body);
    const res = await makeApp().request(
      PATH,
      { method: 'POST', headers: { 'x-internal-sig': sig }, body },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    const [, table, updates] = mockDbUpdate.mock.calls[0];
    expect(table).toBe('voice_calls');
    expect(updates).toMatchObject({ video_recording_url: '/api/voice/recordings/call-8/video' });
  });
});
