/**
 * @module __tests__/sms_agent
 * @description Unit coverage for the inbound SMS reply pipeline
 * ({@link replyToInbound} + {@link simulateInbound}). Twilio, the voice-agent
 * LLM turn, and D1 are all mocked so these exercise the pipeline branches —
 * inbound persistence + idempotency, session load/init, STOP/START opt-out,
 * AI reply composition, first-reply disclosure, length trimming, Twilio send
 * failure resilience, outbound persistence + back-link, and org/site scoping —
 * not the integrations themselves.
 *
 * Convergence r27 — additive spec; no source changes.
 */

jest.mock('../services/db.js', () => ({
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null }),
}));

jest.mock('../services/twilio.js', () => ({
  sendSms: jest.fn(),
}));

jest.mock('../services/voice_agent.js', () => ({
  composeSystemPrompt: jest.fn().mockReturnValue('SYSTEM PROMPT'),
  runTurn: jest.fn(),
}));

import { dbInsert, dbQueryOne, dbUpdate, dbExecute } from '../services/db.js';
import { sendSms } from '../services/twilio.js';
import { composeSystemPrompt, runTurn } from '../services/voice_agent.js';
import { replyToInbound, simulateInbound } from '../services/sms_agent.js';
import type {
  VoiceAgentBusinessProfile,
  VoiceAgentSiteSettings,
} from '../services/voice_agent.js';
import type { Env } from '../types/env.js';

const mockInsert = dbInsert as unknown as jest.Mock;
const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockUpdate = dbUpdate as unknown as jest.Mock;
const mockExecute = dbExecute as unknown as jest.Mock;
const mockSendSms = sendSms as unknown as jest.Mock;
const mockComposeSystemPrompt = composeSystemPrompt as unknown as jest.Mock;
const mockRunTurn = runTurn as unknown as jest.Mock;

const env = { DB: {} } as unknown as Env;

const profile: VoiceAgentBusinessProfile = {
  businessName: "Vito's Mens Salon",
  businessLocation: 'Lake Hiawatha, NJ',
  services: ['Haircut', 'Beard trim'],
};

const settings: VoiceAgentSiteSettings = {
  sms_system_prompt: 'Be friendly.',
  sms_model: 'gpt-4o-mini',
};

function inbound(overrides: Partial<Parameters<typeof replyToInbound>[1]> = {}) {
  return {
    siteId: 'site-1',
    orgId: 'org-1',
    voiceNumberId: 'vn-1',
    fromNumber: '+15551230001',
    toNumber: '+15559990000',
    body: 'Do you have any appointments today?',
    twilioMessageSid: 'SM-inbound-001',
    ...overrides,
  };
}

function turnResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    text: 'We have a 3pm slot open.',
    toolCalls: [],
    signal: 'ok',
    model_used: 'gpt-4o-mini',
    latency_ms: 42,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInsert.mockResolvedValue({ error: null });
  mockQueryOne.mockResolvedValue(null);
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
  mockExecute.mockResolvedValue({ error: null });
  mockSendSms.mockResolvedValue({ sid: 'SM-out-001', status: 'queued', num_segments: 1, price: null });
  mockComposeSystemPrompt.mockReturnValue('SYSTEM PROMPT');
  mockRunTurn.mockResolvedValue(turnResult());
});

describe('replyToInbound — happy path (new conversation)', () => {
  it('persists inbound, creates session, runs a turn, sends + persists outbound', async () => {
    const res = await replyToInbound(env, inbound(), profile, settings);

    expect(res.signal).toBe('ok');
    expect(res.sent).toBe(true);
    expect(res.ai_reply_sid).toBe('SM-out-001');
    expect(res.ai_reply_id).toBeDefined();

    // inbound + outbound rows persisted (2 voice_messages inserts) + 1 session insert
    const messageInserts = mockInsert.mock.calls.filter((c) => c[1] === 'voice_messages');
    expect(messageInserts).toHaveLength(2);
    const sessionInserts = mockInsert.mock.calls.filter((c) => c[1] === 'voice_sessions');
    expect(sessionInserts).toHaveLength(1);

    // LLM turn invoked with the composed system prompt + sms mode
    expect(mockComposeSystemPrompt).toHaveBeenCalledWith(settings, profile, 'sms');
    expect(mockRunTurn).toHaveBeenCalledTimes(1);
    expect(mockRunTurn.mock.calls[0][1]).toMatchObject({
      siteId: 'site-1',
      orgId: 'org-1',
      mode: 'sms',
      model: 'gpt-4o-mini',
    });

    // first reply appends opt-out disclosure
    expect(res.replyText).toContain('We have a 3pm slot open.');
    expect(res.replyText).toContain('Reply STOP to opt out.');

    // outbound was actually sent via Twilio with From=our number, To=customer
    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms.mock.calls[0][1]).toMatchObject({
      from: '+15559990000',
      to: '+15551230001',
    });
  });

  it('back-links the inbound row to its outbound reply id', async () => {
    await replyToInbound(env, inbound(), profile, settings);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [, sql] = mockExecute.mock.calls[0];
    expect(sql).toContain('UPDATE voice_messages SET ai_reply_id');
  });

  it('carries org + site scoping onto persisted message rows', async () => {
    await replyToInbound(env, inbound(), profile, settings);
    for (const call of mockInsert.mock.calls.filter((c) => c[1] === 'voice_messages')) {
      expect(call[2]).toMatchObject({ org_id: 'org-1', site_id: 'site-1', voice_number_id: 'vn-1' });
    }
  });
});

describe('replyToInbound — existing session', () => {
  it('reuses existing session and does NOT create a new one', async () => {
    mockQueryOne.mockResolvedValue({
      id: 'sess-existing',
      context_json: JSON.stringify({
        turns: [{ role: 'user', content: 'hi', ts: 1 }],
        facts: {},
        first_reply_sent: true,
      }),
    });

    const res = await replyToInbound(env, inbound(), profile, settings);

    expect(mockInsert.mock.calls.filter((c) => c[1] === 'voice_sessions')).toHaveLength(0);
    // first_reply_sent already true → no disclosure appended
    expect(res.replyText).not.toContain('Reply STOP to opt out.');
    // session advanced via update with the new turns
    expect(mockUpdate).toHaveBeenCalled();
    const updateArgs = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1];
    expect(updateArgs[1]).toBe('voice_sessions');
  });

  it('caps stored turns at MAX_TURNS (30)', async () => {
    const manyTurns = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
      ts: i,
    }));
    mockQueryOne.mockResolvedValue({
      id: 'sess-long',
      context_json: JSON.stringify({ turns: manyTurns, facts: {}, first_reply_sent: true }),
    });

    await replyToInbound(env, inbound(), profile, settings);

    const updateArgs = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1];
    const persisted = JSON.parse((updateArgs[2] as { context_json: string }).context_json);
    expect(persisted.turns.length).toBe(30);
  });

  it('passes prior history (last 20 turns) into runTurn', async () => {
    const turns = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `h${i}`,
      ts: i,
    }));
    mockQueryOne.mockResolvedValue({
      id: 'sess-h',
      context_json: JSON.stringify({ turns, facts: {}, first_reply_sent: true }),
    });

    await replyToInbound(env, inbound(), profile, settings);
    const history = mockRunTurn.mock.calls[0][1].history as unknown[];
    expect(history).toHaveLength(20);
  });
});

describe('replyToInbound — STOP / opt-out handling', () => {
  it.each(['STOP', 'stop', 'STOPALL', 'unsubscribe', 'cancel', 'end', 'QUIT'])(
    'treats "%s" as a hard opt-out, sends confirmation, never runs a turn',
    async (kw) => {
      const res = await replyToInbound(env, inbound({ body: `  ${kw}  ` }), profile, settings);

      expect(res.signal).toBe('opted_out_sms');
      expect(mockRunTurn).not.toHaveBeenCalled();
      expect(res.replyText).toContain('unsubscribed');
      // opt-out flag persisted on the session
      const updateArgs = mockUpdate.mock.calls.find((c) => c[1] === 'voice_sessions');
      const ctx = JSON.parse((updateArgs![2] as { context_json: string }).context_json);
      expect(ctx.opted_out_sms).toBe(true);
      // confirmation SMS sent
      expect(mockSendSms).toHaveBeenCalledTimes(1);
      expect(res.sent).toBe(true);
    },
  );

  it('reports sent=false but still opted_out when the STOP confirmation SMS fails', async () => {
    mockSendSms.mockRejectedValue(new Error('twilio down'));
    const res = await replyToInbound(env, inbound({ body: 'STOP' }), profile, settings);
    expect(res.signal).toBe('opted_out_sms');
    expect(res.sent).toBe(false);
    expect(res.ai_reply_sid).toBeUndefined();
  });

  it('silently drops messages from an already-opted-out number (no reply)', async () => {
    mockQueryOne.mockResolvedValue({
      id: 'sess-opted',
      context_json: JSON.stringify({ turns: [], facts: {}, opted_out_sms: true }),
    });

    const res = await replyToInbound(env, inbound({ body: 'are you open?' }), profile, settings);

    expect(res.replyText).toBe('');
    expect(res.signal).toBe('opted_out_sms');
    expect(res.sent).toBe(false);
    expect(mockRunTurn).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('re-subscribes on START and re-discloses opt-out on the next reply', async () => {
    mockQueryOne.mockResolvedValue({
      id: 'sess-start',
      context_json: JSON.stringify({
        turns: [],
        facts: {},
        opted_out_sms: true,
        first_reply_sent: true,
      }),
    });

    const res = await replyToInbound(env, inbound({ body: 'start' }), profile, settings);

    // START clears opt-out → flows through to an AI turn + reply
    expect(mockRunTurn).toHaveBeenCalledTimes(1);
    expect(res.signal).toBe('ok');
    expect(res.replyText).toContain('Reply STOP to opt out.');
  });
});

describe('replyToInbound — reply composition + resilience', () => {
  it('falls back to a default reply when the LLM returns empty text', async () => {
    mockRunTurn.mockResolvedValue(turnResult({ text: '' }));
    const res = await replyToInbound(env, inbound(), profile, settings);
    expect(res.replyText).toContain('let me check on that');
  });

  it('trims replies longer than 1500 chars with an ellipsis', async () => {
    mockRunTurn.mockResolvedValue(turnResult({ text: 'x'.repeat(2000) }));
    const res = await replyToInbound(env, inbound(), profile, settings);
    expect(res.replyText.length).toBeLessThanOrEqual(1500);
    expect(res.replyText).toContain('…');
  });

  it('reports sent=false + no outbound row when the reply SMS fails', async () => {
    mockSendSms.mockRejectedValue(new Error('network'));
    const res = await replyToInbound(env, inbound(), profile, settings);
    expect(res.sent).toBe(false);
    expect(res.ai_reply_id).toBeUndefined();
    // only the inbound row is persisted, no outbound
    expect(mockInsert.mock.calls.filter((c) => c[1] === 'voice_messages')).toHaveLength(1);
    // session is still advanced even on send failure
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('maps a runTurn opted_out_sms signal through to the result', async () => {
    mockRunTurn.mockResolvedValue(turnResult({ signal: 'opted_out_sms' }));
    const res = await replyToInbound(env, inbound(), profile, settings);
    expect(res.signal).toBe('opted_out_sms');
  });

  it('propagates escalation/safety signals from the turn', async () => {
    mockRunTurn.mockResolvedValue(turnResult({ signal: 'escalated_safety' }));
    const res = await replyToInbound(env, inbound(), profile, settings);
    expect(res.signal).toBe('escalated_safety');
  });

  it('swallows a duplicate inbound insert (Twilio retry) — guarded by .catch()', async () => {
    // Only the FIRST voice_messages insert (the inbound row) hits the UNIQUE
    // constraint on a retry; the source guards it with .catch(). Later inserts
    // (session, outbound) succeed normally.
    let messageInsertCount = 0;
    mockInsert.mockImplementation((_db: unknown, table: string) => {
      if (table === 'voice_messages') {
        messageInsertCount += 1;
        if (messageInsertCount === 1) return Promise.reject(new Error('UNIQUE constraint'));
      }
      return Promise.resolve({ error: null });
    });
    const res = await replyToInbound(env, inbound(), profile, settings);
    // duplicate inbound swallowed → pipeline still completes + sends a reply
    expect(res.sent).toBe(true);
    expect(res.signal).toBe('ok');
  });

  it('uses default sms_model (undefined) when settings omit it', async () => {
    await replyToInbound(env, inbound(), profile, { sms_system_prompt: 'hi' });
    expect(mockRunTurn.mock.calls[0][1].model).toBeUndefined();
  });
});

describe('replyToInbound — corrupt session context', () => {
  it('recovers from invalid JSON in context_json (treats as empty)', async () => {
    mockQueryOne.mockResolvedValue({ id: 'sess-bad', context_json: '{not valid json' });
    const res = await replyToInbound(env, inbound(), profile, settings);
    // empty context → first_reply_sent false → disclosure appended
    expect(res.replyText).toContain('Reply STOP to opt out.');
    expect(res.signal).toBe('ok');
  });

  it('handles a session row with null context_json', async () => {
    mockQueryOne.mockResolvedValue({ id: 'sess-null', context_json: null });
    const res = await replyToInbound(env, inbound(), profile, settings);
    expect(res.signal).toBe('ok');
    expect(res.replyText).toContain('Reply STOP to opt out.');
  });
});

describe('simulateInbound — dry run', () => {
  it('runs a turn and returns reply + signal + model without persisting anything', async () => {
    mockRunTurn.mockResolvedValue(turnResult({ text: 'Sure, drop by anytime.' }));

    const res = await simulateInbound(env, {
      siteId: 'site-9',
      orgId: 'org-9',
      body: 'Are you open Sunday?',
      profile,
      settings,
    });

    expect(res.replyText).toContain('Sure, drop by anytime.');
    expect(res.replyText).toContain('Reply STOP to opt out.');
    expect(res.signal).toBe('ok');
    expect(res.model_used).toBe('gpt-4o-mini');

    // pure dry run — nothing persisted, no SMS sent
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockComposeSystemPrompt).toHaveBeenCalledWith(settings, profile, 'sms');
  });

  it('threads org/site scoping into the simulated turn', async () => {
    await simulateInbound(env, {
      siteId: 'site-x',
      orgId: 'org-x',
      body: 'hello',
      profile,
      settings,
    });
    expect(mockRunTurn.mock.calls[0][1]).toMatchObject({ siteId: 'site-x', orgId: 'org-x', mode: 'sms' });
  });
});
