/**
 * Unit tests for the Voice Orchestrator (`services/voice_orchestrator`).
 *
 * Covers every branch reachable without a live `WebSocketPair`:
 *   - handleInboundCall: unknown-number TwiML hangup, active-number TwiML with
 *     Connect/Stream, recording clause on/off, voice_calls persistence + insert
 *     resilience, org/site scoping, XML-escaping of the wss URL
 *   - handleInboundSms: unknown-number empty Response, agent reply → <Message>,
 *     empty agent reply → empty Response, body defaulting, message scoping
 *   - handleMediaStream: non-websocket 426, missing callSid/siteId 400,
 *     call-not-found 404 (the guard branches before WebSocketPair)
 *   - triggerBrowseAgent: binding-missing no-op, DO stub fetch ok/non-ok,
 *     stub fetch throw → reason captured
 *
 * Never hits real APIs — db helpers, voice_agent, and sms_agent are all mocked.
 * ts-jest: GLOBAL `jest`; deps cast via `as unknown as jest.Mock`.
 */

jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn(),
  dbUpdate: jest.fn(),
}));

jest.mock('../services/voice_agent.js', () => ({
  composeSystemPrompt: jest.fn(() => 'SYS_PROMPT'),
  runTurn: jest.fn(),
  synthesizeSpeech: jest.fn(),
  transcribeAudioChunk: jest.fn(),
}));

jest.mock('../services/sms_agent.js', () => ({
  replyToInbound: jest.fn(),
}));

import { dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import { replyToInbound } from '../services/sms_agent.js';
import {
  handleInboundCall,
  handleInboundSms,
  handleMediaStream,
  triggerBrowseAgent,
} from '../services/voice_orchestrator.js';

const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockInsert = dbInsert as unknown as jest.Mock;
const mockUpdate = dbUpdate as unknown as jest.Mock;
const mockReply = replyToInbound as unknown as jest.Mock;

function makeEnv(overrides: Record<string, unknown> = {}): any {
  return { DB: {} as unknown, ...overrides };
}

const NUM_ROW = { id: 'vn-1', site_id: 'site-1', org_id: 'org-1' };

beforeEach(() => {
  mockQueryOne.mockReset();
  mockInsert.mockReset().mockResolvedValue(undefined);
  mockUpdate.mockReset().mockResolvedValue(undefined);
  mockReply.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── handleInboundCall ──────────────────────────────────────────────────────

describe('handleInboundCall', () => {
  const payload = {
    CallSid: 'CA123',
    From: '+15550001111',
    To: '+15559990000',
  };

  it('returns a not-configured hangup TwiML when the number is unknown', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // voice_numbers lookup misses
    const out = await handleInboundCall(makeEnv(), payload, 'worker.example.com');
    expect(out).toContain('<Response>');
    expect(out).toContain('not configured');
    expect(out).toContain('<Hangup/>');
    // never persisted a call row
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns a Connect/Stream TwiML and persists the call when active', async () => {
    mockQueryOne
      .mockResolvedValueOnce(NUM_ROW) // voice_numbers
      .mockResolvedValueOnce({ recording_enabled: 1 }); // loadAgentSettings
    const out = await handleInboundCall(makeEnv(), payload, 'worker.example.com');

    expect(out).toContain('This call may be recorded');
    expect(out).toContain('<Connect><Stream url=');
    expect(out).toContain('wss://worker.example.com/webhooks/voice/stream');
    // recording clause present when recording_enabled !== 0
    expect(out).toContain('recordingStatusCallback=');

    // call row persisted with org/site scoping
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [, table, record] = mockInsert.mock.calls[0];
    expect(table).toBe('voice_calls');
    expect(record).toMatchObject({
      voice_number_id: 'vn-1',
      site_id: 'site-1',
      org_id: 'org-1',
      twilio_call_sid: 'CA123',
      direction: 'inbound',
      from_number: '+15550001111',
      to_number: '+15559990000',
      status: 'in-progress',
    });
  });

  it('omits the recording clause when recording_enabled is 0', async () => {
    mockQueryOne
      .mockResolvedValueOnce(NUM_ROW)
      .mockResolvedValueOnce({ recording_enabled: 0 });
    const out = await handleInboundCall(makeEnv(), payload, 'host.dev');
    expect(out).not.toContain('recordingStatusCallback=');
    expect(out).toContain('<Connect><Stream url=');
  });

  it('defaults to recording on when settings row is empty (recording_enabled undefined)', async () => {
    mockQueryOne
      .mockResolvedValueOnce(NUM_ROW)
      .mockResolvedValueOnce(null); // loadAgentSettings → {} fallback
    const out = await handleInboundCall(makeEnv(), payload, 'host.dev');
    // undefined !== 0 → recording clause included
    expect(out).toContain('recordingStatusCallback=');
  });

  it('XML-escapes the wss stream URL (ampersand between params)', async () => {
    mockQueryOne.mockResolvedValueOnce(NUM_ROW).mockResolvedValueOnce({});
    const out = await handleInboundCall(makeEnv(), payload, 'host.dev');
    // the &siteId= separator must be escaped to &amp; inside the attribute
    expect(out).toContain('&amp;siteId=');
    expect(out).not.toContain('&siteId=');
  });

  it('still returns TwiML when the call-row insert rejects', async () => {
    mockQueryOne.mockResolvedValueOnce(NUM_ROW).mockResolvedValueOnce({ recording_enabled: 1 });
    mockInsert.mockRejectedValueOnce(new Error('UNIQUE constraint'));
    const out = await handleInboundCall(makeEnv(), payload, 'host.dev');
    expect(out).toContain('<Connect><Stream url=');
  });
});

// ─── handleInboundSms ───────────────────────────────────────────────────────

describe('handleInboundSms', () => {
  const sms = {
    MessageSid: 'SM123',
    From: '+15550001111',
    To: '+15559990000',
    Body: 'hi there',
  };

  it('returns an empty Response when the number is unknown', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const out = await handleInboundSms(makeEnv(), sms);
    expect(out).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('returns a <Message> TwiML with the agent reply when active', async () => {
    mockQueryOne
      .mockResolvedValueOnce(NUM_ROW) // voice_numbers
      .mockResolvedValueOnce({}) // loadAgentSettings
      .mockResolvedValueOnce({ business_name: 'Acme', business_address: '1 Main St' }); // profile
    mockReply.mockResolvedValueOnce({ replyText: 'Thanks for reaching out!', signal: 'ok', sent: true });

    const out = await handleInboundSms(makeEnv(), sms);
    expect(out).toContain('<Message>Thanks for reaching out!</Message>');

    // message routed to replyToInbound with proper scoping + body
    const [, msg] = mockReply.mock.calls[0];
    expect(msg).toMatchObject({
      siteId: 'site-1',
      orgId: 'org-1',
      voiceNumberId: 'vn-1',
      fromNumber: '+15550001111',
      toNumber: '+15559990000',
      body: 'hi there',
      twilioMessageSid: 'SM123',
    });
  });

  it('returns an empty Response when the agent reply is empty (silent STOP)', async () => {
    mockQueryOne
      .mockResolvedValueOnce(NUM_ROW)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(null);
    mockReply.mockResolvedValueOnce({ replyText: '', signal: 'opted_out_sms', sent: false });

    const out = await handleInboundSms(makeEnv(), sms);
    expect(out).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  it('defaults Body to empty string when absent', async () => {
    mockQueryOne
      .mockResolvedValueOnce(NUM_ROW)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(null);
    mockReply.mockResolvedValueOnce({ replyText: 'ok', signal: 'ok', sent: true });

    await handleInboundSms(makeEnv(), { MessageSid: 'SM9', From: '+1', To: '+2' });
    const [, msg] = mockReply.mock.calls[0];
    expect(msg.body).toBe('');
  });

  it('XML-escapes the reply body in the <Message>', async () => {
    mockQueryOne
      .mockResolvedValueOnce(NUM_ROW)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(null);
    mockReply.mockResolvedValueOnce({ replyText: 'Tom & Jerry <hi>', signal: 'ok', sent: true });

    const out = await handleInboundSms(makeEnv(), sms);
    expect(out).toContain('Tom &amp; Jerry &lt;hi&gt;');
  });
});

// ─── handleMediaStream (guard branches before WebSocketPair) ─────────────────

describe('handleMediaStream', () => {
  function req(url: string, headers: Record<string, string> = {}): Request {
    return new Request(url, { headers });
  }

  it('returns 426 when the upgrade header is not websocket', async () => {
    const res = await handleMediaStream(makeEnv(), req('https://w.dev/webhooks/voice/stream'));
    expect(res.status).toBe(426);
    expect(await res.text()).toContain('Expected WebSocket upgrade');
  });

  it('returns 400 when callSid or siteId is missing', async () => {
    const res = await handleMediaStream(
      makeEnv(),
      req('https://w.dev/webhooks/voice/stream?callSid=CA1', { upgrade: 'websocket' }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('callSid + siteId required');
  });

  it('returns 404 when the call row is not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // voice_calls lookup miss
    const res = await handleMediaStream(
      makeEnv(),
      req('https://w.dev/webhooks/voice/stream?callSid=CA1&siteId=site-1', {
        upgrade: 'websocket',
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Call not found');
  });
});

// ─── triggerBrowseAgent ─────────────────────────────────────────────────────

describe('triggerBrowseAgent', () => {
  it('is a no-op when the VOICE_BROWSE_AGENT binding is absent', async () => {
    const out = await triggerBrowseAgent(makeEnv(), 'call-1', 'find hours');
    expect(out).toEqual({ ok: false, reason: 'binding_missing' });
  });

  it('returns ok:true when the DO stub fetch succeeds', async () => {
    const stubFetch = jest.fn(async () => new Response(null, { status: 200 }));
    const env = makeEnv({
      VOICE_BROWSE_AGENT: {
        idFromName: jest.fn(() => 'do-id'),
        get: jest.fn(() => ({ fetch: stubFetch })),
      },
    });
    const out = await triggerBrowseAgent(env, 'call-1', 'find hours');
    expect(out).toEqual({ ok: true, reason: undefined });
    expect(env.VOICE_BROWSE_AGENT.idFromName).toHaveBeenCalledWith('call-1');
    // verify the POST body carried the call id + query
    const [, init] = stubFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ callId: 'call-1', query: 'find hours' });
  });

  it('returns ok:false with a status reason on a non-ok DO response', async () => {
    const stubFetch = jest.fn(async () => new Response(null, { status: 503 }));
    const env = makeEnv({
      VOICE_BROWSE_AGENT: {
        idFromName: jest.fn(() => 'do-id'),
        get: jest.fn(() => ({ fetch: stubFetch })),
      },
    });
    const out = await triggerBrowseAgent(env, 'call-2', 'x');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('status 503');
  });

  it('captures the error message when the DO stub fetch throws', async () => {
    const env = makeEnv({
      VOICE_BROWSE_AGENT: {
        idFromName: jest.fn(() => 'do-id'),
        get: jest.fn(() => ({
          fetch: jest.fn(async () => {
            throw new Error('DO unreachable');
          }),
        })),
      },
    });
    const out = await triggerBrowseAgent(env, 'call-3', 'x');
    expect(out).toEqual({ ok: false, reason: 'DO unreachable' });
  });
});
