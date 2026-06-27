/**
 * Unit tests for the Voice Orchestrator (`services/voice_orchestrator`).
 *
 * The inbound VOICE call path now runs on LiveKit Cloud (see voice-architecture.md),
 * so the orchestrator only handles inbound SMS:
 *   - handleInboundSms: unknown-number empty Response, agent reply → <Message>,
 *     empty agent reply → empty Response, body defaulting, message scoping
 *
 * Never hits real APIs — db helpers and sms_agent are mocked.
 * ts-jest: GLOBAL `jest`; deps cast via `as unknown as jest.Mock`.
 */

jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
}));

jest.mock('../services/sms_agent.js', () => ({
  replyToInbound: jest.fn(),
}));

import { dbQueryOne } from '../services/db.js';
import { replyToInbound } from '../services/sms_agent.js';
import { handleInboundSms } from '../services/voice_orchestrator.js';

const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockReply = replyToInbound as unknown as jest.Mock;

function makeEnv(overrides: Record<string, unknown> = {}): any {
  return { DB: {} as unknown, ...overrides };
}

const NUM_ROW = { id: 'vn-1', site_id: 'site-1', org_id: 'org-1' };

beforeEach(() => {
  mockQueryOne.mockReset();
  mockReply.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
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
    mockReply.mockResolvedValueOnce({
      replyText: 'Thanks for reaching out!',
      signal: 'ok',
      sent: true,
    });

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
