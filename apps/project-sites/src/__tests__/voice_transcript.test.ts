/**
 * Call-transcript persistence — `services/voice_transcript` + the HMAC-signed
 * `/internal/voice/transcript` route. The LiveKit agent posts a finished call's
 * transcript; it lands in `voice_calls` (→ admin Conversations). db is mocked.
 */
jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn(async () => undefined),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbInsert, dbQueryOne } from '../services/db.js';
import { recordVoiceTranscript } from '../services/voice_transcript.js';
import { voiceWebhookRoutes } from '../routes/voice_webhooks.js';

const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockInsert = dbInsert as unknown as jest.Mock;

function makeEnv(over: Record<string, unknown> = {}): Env {
  return { DB: {} as unknown, ...over } as unknown as Env;
}

const TRANSCRIPT = [
  { role: 'assistant' as const, text: 'Hi, how can I help?', ts_ms: 1 },
  { role: 'user' as const, text: 'What are your hours?', ts_ms: 2 },
  { role: 'assistant' as const, text: 'Nine to five, Monday to Friday.', ts_ms: 3 },
];

beforeEach(() => {
  mockQueryOne.mockReset();
  mockInsert.mockReset().mockResolvedValue(undefined);
});

describe('recordVoiceTranscript', () => {
  it('stores a voice_calls row with transcript + summary when the number maps to a site', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'vn-1', site_id: 'site-1', org_id: 'org-1' });
    const res = await recordVoiceTranscript(makeEnv(), {
      callId: 'room_abc',
      dialedNumber: '+15551234567',
      callerNumber: '+15559998888',
      transcript: TRANSCRIPT,
      startedAtMs: 1000,
      endedAtMs: 61000,
    });
    expect(res).toEqual({ stored: true, callId: 'room_abc' });
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [, table, row] = mockInsert.mock.calls[0];
    expect(table).toBe('voice_calls');
    expect(row).toMatchObject({
      voice_number_id: 'vn-1',
      site_id: 'site-1',
      org_id: 'org-1',
      twilio_call_sid: 'room_abc',
      direction: 'inbound',
      to_number: '+15551234567',
      from_number: '+15559998888',
      status: 'completed',
      duration_seconds: 60,
    });
    expect(JSON.parse(row.transcript_json)).toHaveLength(3);
    expect(row.summary).toContain('What are your hours?');
  });

  it('is a no-op (stored:false) when the dialed number is not mapped', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await recordVoiceTranscript(makeEnv(), {
      callId: 'room_x',
      dialedNumber: '+15550000000',
      transcript: TRANSCRIPT,
    });
    expect(res.stored).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

// ─── route HMAC gate ────────────────────────────────────────────

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.route('/', voiceWebhookRoutes);
const SECRET = 'internal-secret';

async function hmacHex(body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('POST /internal/voice/transcript', () => {
  const PATH = '/internal/voice/transcript';

  it('returns 401 on a bad HMAC signature', async () => {
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'x-internal-sig': 'deadbeef' }, body: '{}' },
      makeEnv({ INTERNAL_BUILD_SECRET: SECRET }),
    );
    expect(res.status).toBe(401);
  });

  it('persists on a valid signature', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'vn-1', site_id: 'site-1', org_id: 'org-1' });
    const body = JSON.stringify({
      callId: 'room_ok',
      dialedNumber: '+15551234567',
      transcript: TRANSCRIPT,
    });
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'x-internal-sig': await hmacHex(body) }, body },
      makeEnv({ INTERNAL_BUILD_SECRET: SECRET }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { stored: boolean }).toEqual({ stored: true, callId: 'room_ok' });
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});
