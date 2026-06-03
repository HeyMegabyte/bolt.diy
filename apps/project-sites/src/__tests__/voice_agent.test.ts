/**
 * @module __tests__/voice_agent
 * @description Unit coverage for the inbound voice-agent service
 * ({@link composeSystemPrompt}, {@link runTurn}, {@link transcribeAudioChunk},
 * {@link synthesizeSpeech}). The external LLM, MCP tool surface, Anthropic
 * Memory tool, AI logger, and `fetch`/`env.AI` are all mocked so these exercise
 * the pipeline branches — prompt composition + meta bookending, signal
 * detection (safety / scam / SMS opt-out), tool-call dispatch (escalate /
 * browse / memory / MCP), LLM-failure resilience, logging, STT provider
 * routing + fallback, and TTS provider routing + stub fallback — not the
 * integrations themselves.
 *
 * Convergence r28 — additive spec; no source changes.
 */

jest.mock('../services/external_llm.js', () => ({
  callExternalLLM: jest.fn(),
}));

jest.mock('../services/mcp_client.js', () => ({
  loadAvailableTools: jest.fn(),
  executeTool: jest.fn(),
}));

jest.mock('../services/ai_logger.js', () => ({
  writeAiLog: jest.fn(),
}));

jest.mock('../services/anthropic_memory.js', () => ({
  buildMemoryToolDef: jest.fn(),
  executeMemoryTool: jest.fn(),
}));

import { callExternalLLM } from '../services/external_llm.js';
import { loadAvailableTools, executeTool } from '../services/mcp_client.js';
import { writeAiLog } from '../services/ai_logger.js';
import { buildMemoryToolDef, executeMemoryTool } from '../services/anthropic_memory.js';
import {
  PROMPT_META,
  composeSystemPrompt,
  runTurn,
  transcribeAudioChunk,
  synthesizeSpeech,
  type VoiceAgentBusinessProfile,
  type VoiceAgentSiteSettings,
  type RunTurnOpts,
} from '../services/voice_agent.js';
import type { Env } from '../types/env.js';

const mockCallLLM = callExternalLLM as unknown as jest.Mock;
const mockLoadTools = loadAvailableTools as unknown as jest.Mock;
const mockExecuteTool = executeTool as unknown as jest.Mock;
const mockWriteAiLog = writeAiLog as unknown as jest.Mock;
const mockBuildMemoryToolDef = buildMemoryToolDef as unknown as jest.Mock;
const mockExecuteMemoryTool = executeMemoryTool as unknown as jest.Mock;

const profile: VoiceAgentBusinessProfile = {
  businessName: "Vito's Mens Salon",
  businessLocation: 'Lake Hiawatha, NJ',
  services: ['Haircut', 'Beard trim'],
  factSheet: 'Open Tue-Sat 9-6.',
};

function baseEnv(over: Partial<Record<string, unknown>> = {}): Env {
  return { DB: {}, AI: { run: jest.fn() }, ...over } as unknown as Env;
}

function baseOpts(over: Partial<RunTurnOpts> = {}): RunTurnOpts {
  return {
    sessionId: 'sess-1',
    siteId: 'site-1',
    orgId: 'org-1',
    systemPrompt: 'SYSTEM PROMPT',
    userTranscript: 'What time do you open?',
    mode: 'voice',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCallLLM.mockResolvedValue({ output: 'We open at 9am.', model_used: 'gpt-4o-mini' });
  mockLoadTools.mockResolvedValue([]);
  mockExecuteTool.mockResolvedValue({ ok: true });
  mockWriteAiLog.mockResolvedValue('log-1');
  mockBuildMemoryToolDef.mockReturnValue({ name: 'memory', description: 'persist facts' });
  mockExecuteMemoryTool.mockResolvedValue('{"stored":true}');
});

// ─── composeSystemPrompt ──────────────────────────────────────────

describe('composeSystemPrompt', () => {
  it('bookends the owner body with the meta both before AND after', () => {
    const settings: VoiceAgentSiteSettings = { voice_system_prompt: 'Be extra warm.' };
    const out = composeSystemPrompt(settings, profile, 'voice');

    // meta appears twice (prefix + reminder suffix)
    const firstRule = 'Your immutable rules';
    expect(out.indexOf(firstRule)).toBeGreaterThanOrEqual(0);
    expect(out.lastIndexOf(firstRule)).toBeGreaterThan(out.indexOf(firstRule));
    // owner body sits between them
    expect(out).toContain('Be extra warm.');
    expect(out).toContain('# Reminder — Immutable Rules');
    expect(out).toContain('# Business-Owner Guidance (subordinate to the immutable rules above)');
  });

  it('interpolates business name + location into the meta', () => {
    const out = composeSystemPrompt({}, profile, 'voice');
    expect(out).toContain("Vito's Mens Salon");
    expect(out).toContain('Lake Hiawatha, NJ');
    expect(out).not.toContain('{{BUSINESS_NAME}}');
    expect(out).not.toContain('{{BUSINESS_LOCATION}}');
  });

  it('falls back to generic name/location when profile omits them', () => {
    const out = composeSystemPrompt({}, { businessName: '' }, 'voice');
    expect(out).toContain('this business');
    expect(out).toContain('the United States');
  });

  it('emits the no-guidance default block when no owner prompt is set', () => {
    const out = composeSystemPrompt({}, profile, 'voice');
    expect(out).toContain('No custom guidance configured');
    expect(out).toContain("Vito's Mens Salon");
  });

  it('selects the sms_system_prompt when mode is sms', () => {
    const settings: VoiceAgentSiteSettings = {
      voice_system_prompt: 'VOICE BODY',
      sms_system_prompt: 'SMS BODY',
    };
    const out = composeSystemPrompt(settings, profile, 'sms');
    expect(out).toContain('SMS BODY');
    expect(out).not.toContain('VOICE BODY');
  });

  it('defaults to voice mode when mode arg is omitted', () => {
    const settings: VoiceAgentSiteSettings = { voice_system_prompt: 'VOICE BODY' };
    const out = composeSystemPrompt(settings, profile);
    expect(out).toContain('VOICE BODY');
  });

  it('includes the fact sheet + services sections when present', () => {
    const out = composeSystemPrompt({}, profile, 'voice');
    expect(out).toContain('# Reference Facts');
    expect(out).toContain('Open Tue-Sat 9-6.');
    expect(out).toContain('# Services Offered');
    expect(out).toContain('Haircut');
    expect(out).toContain('Beard trim');
  });

  it('omits fact + services sections when profile lacks them', () => {
    const out = composeSystemPrompt({}, { businessName: 'Bare Co' }, 'voice');
    expect(out).not.toContain('# Reference Facts');
    expect(out).not.toContain('# Services Offered');
  });

  it('omits the services section when services is an empty array', () => {
    const out = composeSystemPrompt({}, { businessName: 'Bare Co', services: [] }, 'voice');
    expect(out).not.toContain('# Services Offered');
  });

  it('trims an owner prompt that is only whitespace down to the default block', () => {
    const out = composeSystemPrompt({ voice_system_prompt: '   ' }, profile, 'voice');
    expect(out).toContain('No custom guidance configured');
  });

  it('PROMPT_META carries the non-negotiable safety + compliance rules', () => {
    expect(PROMPT_META).toContain('This call may be recorded');
    expect(PROMPT_META).toContain('988');
    expect(PROMPT_META).toContain('Reply STOP to opt out.');
    expect(PROMPT_META).toContain('Never claim to be human');
  });
});

// ─── runTurn — happy path + logging ───────────────────────────────

describe('runTurn — happy path', () => {
  it('returns the LLM text, ok signal, model + latency, and logs the turn', async () => {
    const env = baseEnv();
    const res = await runTurn(env, baseOpts());

    expect(res.text).toBe('We open at 9am.');
    expect(res.signal).toBe('ok');
    expect(res.model_used).toBe('gpt-4o-mini');
    expect(res.toolCalls).toHaveLength(0);
    expect(typeof res.latency_ms).toBe('number');

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    const llmArgs = mockCallLLM.mock.calls[0][1];
    expect(llmArgs.system).toContain('SYSTEM PROMPT');
    expect(llmArgs.user).toContain('What time do you open?');
    expect(llmArgs.provider).toBe('auto');

    expect(mockWriteAiLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAiLog.mock.calls[0][1]).toMatchObject({
      orgId: 'org-1',
      siteId: 'site-1',
      traceKind: 'chat',
      status: 'ok',
    });
  });

  it('threads prior history (capped at last 20) into the user block', async () => {
    const history = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turn-${i}`,
    }));
    const env = baseEnv();
    await runTurn(env, baseOpts({ history }));

    const userBlock = mockCallLLM.mock.calls[0][1].user as string;
    expect(userBlock).toContain('turn-24'); // most recent kept
    expect(userBlock).not.toContain('turn-4'); // beyond the last-20 window dropped
    expect(userBlock).toContain('Caller:'); // user-turn label
    expect(userBlock).toContain('Agent:'); // assistant-turn label + final prompt cue
  });

  it('uses a tighter maxTokens budget + sms label for sms mode', async () => {
    const env = baseEnv();
    await runTurn(env, baseOpts({ mode: 'sms' }));
    expect(mockCallLLM.mock.calls[0][1].maxTokens).toBe(320);
    expect(mockWriteAiLog.mock.calls[0][1].input).toMatchObject({ mode: 'sms' });
  });

  it('uses a larger maxTokens budget for voice mode', async () => {
    const env = baseEnv();
    await runTurn(env, baseOpts({ mode: 'voice' }));
    expect(mockCallLLM.mock.calls[0][1].maxTokens).toBe(512);
  });

  it('honors an explicit model override', async () => {
    const env = baseEnv();
    await runTurn(env, baseOpts({ model: 'gpt-4o' }));
    expect(mockCallLLM.mock.calls[0][1].model).toBe('gpt-4o');
  });

  it('uses the 512 voice budget when mode is omitted (sms-only narrows it)', async () => {
    // The tool surface gate is `enableBrowseAgent || mode === 'voice'` — an
    // explicitly-undefined mode does NOT match 'voice', so tools are skipped,
    // but the maxTokens default (`mode === 'sms' ? 320 : 512`) still lands on 512.
    const env = baseEnv();
    const res = await runTurn(env, baseOpts({ mode: undefined }));
    expect(res.signal).toBe('ok');
    expect(mockLoadTools).not.toHaveBeenCalled();
    expect(mockCallLLM.mock.calls[0][1].maxTokens).toBe(512);
  });
});

// ─── runTurn — tool surface composition ───────────────────────────

describe('runTurn — tool surface', () => {
  it('lists MCP tools + browse/fill/escalate/memory in the system prompt for voice', async () => {
    mockLoadTools.mockResolvedValue([{ name: 'book_appt', description: 'books a slot' }]);
    const env = baseEnv();
    await runTurn(env, baseOpts({ mode: 'voice' }));

    const sys = mockCallLLM.mock.calls[0][1].system as string;
    expect(sys).toContain('browse_web');
    expect(sys).toContain('fill_form');
    expect(sys).toContain('escalate_to_human');
    expect(sys).toContain('memory: persist facts');
    expect(sys).toContain('book_appt: books a slot');
    expect(mockBuildMemoryToolDef).toHaveBeenCalledWith({ kind: 'voice_agent', id: 'sess-1' });
  });

  it('still exposes tools for sms mode when enableBrowseAgent is set', async () => {
    const env = baseEnv();
    await runTurn(env, baseOpts({ mode: 'sms', enableBrowseAgent: true }));
    expect(mockLoadTools).toHaveBeenCalled();
    expect(mockCallLLM.mock.calls[0][1].system).toContain('browse_web');
  });

  it('skips the tool surface for sms mode without enableBrowseAgent', async () => {
    const env = baseEnv();
    await runTurn(env, baseOpts({ mode: 'sms' }));
    expect(mockLoadTools).not.toHaveBeenCalled();
  });

  it('survives a thrown loadAvailableTools (tool surface stays optional)', async () => {
    mockLoadTools.mockRejectedValue(new Error('mcp down'));
    const env = baseEnv();
    const res = await runTurn(env, baseOpts({ mode: 'voice' }));
    expect(res.signal).toBe('ok');
    // no tool list appended, but the turn still ran
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
  });
});

// ─── runTurn — tool-call dispatch ─────────────────────────────────

// NOTE on TOOL_CALL parsing (convergence r48 — bug fixed): the source now uses
// a balanced-brace scan (`extractToolCall`) instead of the non-greedy regex
// `/TOOL_CALL:\s*(\{[\s\S]+?\})/m`, which stopped at the FIRST `}`. A directive
// whose `args` object contains keys (e.g. `{"name":"x","args":{"q":"y"}}`) — or
// nested objects inside args — now round-trips with its args intact instead of
// being silently dropped. Braces inside JSON string values no longer close the
// object early. These tests exercise both args-less and args-bearing directives.
describe('runTurn — tool-call dispatch', () => {
  it('handles escalate_to_human (args-less) and maps the signal to human_handoff', async () => {
    mockCallLLM.mockResolvedValue({
      output: 'Let me get a teammate. TOOL_CALL: {"name":"escalate_to_human"}',
      model_used: 'gpt-4o-mini',
    });
    const env = baseEnv();
    const res = await runTurn(env, baseOpts());

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toMatchObject({ name: 'escalate_to_human', result: { ok: true, handoff: true } });
    expect(res.signal).toBe('human_handoff');
    // TOOL_CALL JSON stripped from spoken text
    expect(res.text).not.toContain('TOOL_CALL');
    expect(res.text).toContain('Let me get a teammate.');
  });

  it('defers browse_web to the orchestrator browse agent (args-less)', async () => {
    mockCallLLM.mockResolvedValue({
      output: 'Checking. TOOL_CALL: {"name":"browse_web"}',
      model_used: 'gpt-4o-mini',
    });
    const env = baseEnv();
    const res = await runTurn(env, baseOpts());
    expect(res.toolCalls[0].result).toMatchObject({ deferred: 'browse_agent' });
    expect(res.toolCalls[0].result).toMatchObject({ deferred_call: { name: 'browse_web', args: {} } });
  });

  it('defers fill_form to the orchestrator browse agent (args-less)', async () => {
    mockCallLLM.mockResolvedValue({
      output: 'TOOL_CALL: {"name":"fill_form"}',
      model_used: 'gpt-4o-mini',
    });
    const env = baseEnv();
    const res = await runTurn(env, baseOpts());
    expect(res.toolCalls[0].result).toMatchObject({ deferred: 'browse_agent' });
  });

  it('routes memory tool calls through executeMemoryTool (args-less)', async () => {
    mockCallLLM.mockResolvedValue({
      output: 'TOOL_CALL: {"name":"memory"}',
      model_used: 'gpt-4o-mini',
    });
    const env = baseEnv();
    const res = await runTurn(env, baseOpts());
    expect(mockExecuteMemoryTool).toHaveBeenCalledWith(
      env,
      { kind: 'voice_agent', id: 'sess-1' },
      { input: {} },
    );
    expect(res.toolCalls[0].result).toEqual({ stored: true });
  });

  it('dispatches unknown tool names to the MCP executeTool (args-less)', async () => {
    mockExecuteTool.mockResolvedValue({ ok: true, booked: 'tue-3pm' });
    mockCallLLM.mockResolvedValue({
      output: 'TOOL_CALL: {"name":"book_appt"}',
      model_used: 'gpt-4o-mini',
    });
    const env = baseEnv();
    const res = await runTurn(env, baseOpts());
    expect(mockExecuteTool).toHaveBeenCalledWith(env, 'site-1', {
      name: 'book_appt',
      arguments: {},
    });
    expect(res.toolCalls[0].result).toMatchObject({ booked: 'tue-3pm' });
  });

  it('defaults to empty args for an args-less directive', async () => {
    mockCallLLM.mockResolvedValue({
      output: 'TOOL_CALL: {"name":"escalate_to_human"}',
      model_used: 'gpt-4o-mini',
    });
    const env = baseEnv();
    const res = await runTurn(env, baseOpts());
    expect(res.toolCalls[0].args).toEqual({});
  });

  it('dispatches an args-bearing directive with its args intact (balanced-brace parse)', async () => {
    mockExecuteTool.mockResolvedValue({ ok: true, booked: 'tue-3pm' });
    mockCallLLM.mockResolvedValue({
      output: 'Sure. TOOL_CALL: {"name":"book_appt","args":{"when":"tue"}}',
      model_used: 'gpt-4o-mini',
    });
    const env = baseEnv();
    const res = await runTurn(env, baseOpts());
    // balanced-brace scan captures the full object → args dispatched, not dropped
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].args).toEqual({ when: 'tue' });
    expect(mockExecuteTool).toHaveBeenCalledWith(env, 'site-1', {
      name: 'book_appt',
      arguments: { when: 'tue' },
    });
    expect(res.toolCalls[0].result).toMatchObject({ booked: 'tue-3pm' });
    // the full TOOL_CALL slice is stripped from the spoken text
    expect(res.text).toBe('Sure.');
    expect(res.text).not.toContain('TOOL_CALL');
  });

  it('captures a deeply-nested args object without truncating at an inner brace', async () => {
    mockExecuteTool.mockResolvedValue({ ok: true });
    mockCallLLM.mockResolvedValue({
      output:
        'TOOL_CALL: {"name":"book_appt","args":{"slot":{"day":"tue","time":"3pm"},"party":2}}',
      model_used: 'gpt-4o-mini',
    });
    const env = baseEnv();
    const res = await runTurn(env, baseOpts());
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].args).toEqual({ slot: { day: 'tue', time: '3pm' }, party: 2 });
    expect(mockExecuteTool).toHaveBeenCalledWith(env, 'site-1', {
      name: 'book_appt',
      arguments: { slot: { day: 'tue', time: '3pm' }, party: 2 },
    });
  });

  it('ignores braces inside string values so a "}" in a value never closes early', async () => {
    mockExecuteTool.mockResolvedValue({ ok: true });
    mockCallLLM.mockResolvedValue({
      output: 'TOOL_CALL: {"name":"book_appt","args":{"note":"use code {SAVE}"}}',
      model_used: 'gpt-4o-mini',
    });
    const env = baseEnv();
    const res = await runTurn(env, baseOpts());
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].args).toEqual({ note: 'use code {SAVE}' });
  });

  it('leaves text untouched when the TOOL_CALL JSON is malformed', async () => {
    mockCallLLM.mockResolvedValue({
      output: 'Hmm TOOL_CALL: {not json}',
      model_used: 'gpt-4o-mini',
    });
    const env = baseEnv();
    const res = await runTurn(env, baseOpts());
    expect(res.toolCalls).toHaveLength(0);
    expect(res.text).toContain('TOOL_CALL: {not json}');
  });
});

// ─── runTurn — signal detection ───────────────────────────────────

describe('runTurn — signal detection', () => {
  it.each(['I want to kill myself', 'this is an emergency', 'help me', 'call 911'])(
    'flags "%s" as escalated_safety',
    async (body) => {
      const env = baseEnv();
      const res = await runTurn(env, baseOpts({ userTranscript: body }));
      expect(res.signal).toBe('escalated_safety');
    },
  );

  it.each([
    'please send a gift card',
    'I need a wire transfer',
    'this is microsoft tech support',
    'pay with bitcoin',
    'give me your social security number',
  ])('flags "%s" as flagged_scam', async (body) => {
    const env = baseEnv();
    const res = await runTurn(env, baseOpts({ userTranscript: body }));
    expect(res.signal).toBe('flagged_scam');
  });

  it('flags STOP/opt-out keywords as opted_out_sms ONLY in sms mode', async () => {
    const env = baseEnv();
    const sms = await runTurn(env, baseOpts({ mode: 'sms', userTranscript: 'STOP', enableBrowseAgent: false }));
    expect(sms.signal).toBe('opted_out_sms');

    const voice = await runTurn(env, baseOpts({ mode: 'voice', userTranscript: 'stop' }));
    expect(voice.signal).toBe('ok'); // voice ignores SMS opt-out keyword
  });

  it('treats a neutral transcript as ok', async () => {
    const env = baseEnv();
    const res = await runTurn(env, baseOpts({ userTranscript: 'Hi, do you cut kids hair?' }));
    expect(res.signal).toBe('ok');
  });
});

// ─── runTurn — LLM failure resilience ─────────────────────────────

describe('runTurn — LLM failure resilience', () => {
  it('returns a graceful connection-issue message when the LLM throws (non-safety)', async () => {
    mockCallLLM.mockRejectedValue(new Error('upstream 503'));
    const env = baseEnv();
    const res = await runTurn(env, baseOpts({ userTranscript: 'are you open?' }));
    expect(res.text).toContain('brief connection issue');
    expect(res.signal).toBe('ok');
    // logging still happens even after the failure
    expect(mockWriteAiLog).toHaveBeenCalledTimes(1);
  });

  it('returns the 911/988 safety script when the LLM throws on a safety call', async () => {
    mockCallLLM.mockRejectedValue(new Error('boom'));
    const env = baseEnv();
    const res = await runTurn(env, baseOpts({ userTranscript: 'I want to hurt myself' }));
    expect(res.signal).toBe('escalated_safety');
    expect(res.text).toContain('911');
    expect(res.text).toContain('988');
  });

  it('does not blow up when writeAiLog itself rejects', async () => {
    mockWriteAiLog.mockRejectedValue(new Error('log sink down'));
    const env = baseEnv();
    const res = await runTurn(env, baseOpts());
    expect(res.signal).toBe('ok');
    expect(res.text).toBe('We open at 9am.');
  });
});

// ─── transcribeAudioChunk — STT ───────────────────────────────────

describe('transcribeAudioChunk', () => {
  const audio = new ArrayBuffer(8);

  afterEach(() => {
    (globalThis.fetch as unknown as jest.Mock | undefined)?.mockReset?.();
  });

  it('uses Deepgram when DEEPGRAM_API_KEY is set and the call succeeds', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: { channels: [{ alternatives: [{ transcript: 'hello there', confidence: 0.97 }] }] },
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const env = baseEnv({ DEEPGRAM_API_KEY: 'dg-key' });

    const res = await transcribeAudioChunk(env, audio);
    expect(res.provider).toBe('deepgram');
    expect(res.text).toBe('hello there');
    expect(res.confidence).toBe(0.97);
    expect(fetchMock.mock.calls[0][0]).toContain('api.deepgram.com');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Token dg-key');
  });

  it('falls back to Workers AI Whisper when Deepgram returns non-ok', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const aiRun = jest.fn().mockResolvedValue({ text: 'whisper transcript' });
    const env = baseEnv({ DEEPGRAM_API_KEY: 'dg-key', AI: { run: aiRun } });

    const res = await transcribeAudioChunk(env, audio);
    expect(res.provider).toBe('workers-ai-whisper');
    expect(res.text).toBe('whisper transcript');
    expect(aiRun).toHaveBeenCalled();
  });

  it('falls back to Whisper when the Deepgram fetch throws', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const aiRun = jest.fn().mockResolvedValue({ text: 'recovered' });
    const env = baseEnv({ DEEPGRAM_API_KEY: 'dg-key', AI: { run: aiRun } });

    const res = await transcribeAudioChunk(env, audio);
    expect(res.provider).toBe('workers-ai-whisper');
    expect(res.text).toBe('recovered');
  });

  it('goes straight to Whisper when no Deepgram key is configured', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const aiRun = jest.fn().mockResolvedValue({ text: 'direct whisper' });
    const env = baseEnv({ AI: { run: aiRun } });

    const res = await transcribeAudioChunk(env, audio);
    expect(res.provider).toBe('workers-ai-whisper');
    expect(res.text).toBe('direct whisper');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles a string result from Workers AI Whisper', async () => {
    const aiRun = jest.fn().mockResolvedValue('plain string transcript');
    const env = baseEnv({ AI: { run: aiRun } });
    const res = await transcribeAudioChunk(env, audio);
    expect(res.text).toBe('plain string transcript');
  });

  it('returns provider:noop with empty text when Whisper also throws', async () => {
    const aiRun = jest.fn().mockRejectedValue(new Error('ai down'));
    const env = baseEnv({ AI: { run: aiRun } });
    const res = await transcribeAudioChunk(env, audio);
    expect(res.provider).toBe('noop');
    expect(res.text).toBe('');
  });

  it('treats a missing transcript field in the Deepgram payload as empty', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ results: {} }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const env = baseEnv({ DEEPGRAM_API_KEY: 'dg-key' });
    const res = await transcribeAudioChunk(env, audio);
    expect(res.provider).toBe('deepgram');
    expect(res.text).toBe('');
  });
});

// ─── synthesizeSpeech — TTS ───────────────────────────────────────

describe('synthesizeSpeech', () => {
  afterEach(() => {
    (globalThis.fetch as unknown as jest.Mock | undefined)?.mockReset?.();
  });

  it('returns a stub (empty buffer) when ELEVENLABS_API_KEY is missing', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await synthesizeSpeech(baseEnv(), 'hello');
    expect(res.provider).toBe('stub');
    expect(res.bytes.byteLength).toBe(0);
    expect(res.mime).toBe('audio/mpeg');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('synthesizes via ElevenLabs with the default voice when key is set', async () => {
    const audioOut = new ArrayBuffer(16);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => audioOut,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const env = baseEnv({ ELEVENLABS_API_KEY: 'el-key' });

    const res = await synthesizeSpeech(env, 'welcome in');
    expect(res.provider).toBe('elevenlabs');
    expect(res.bytes.byteLength).toBe(16);
    // default Rachel voice id in the URL
    expect(fetchMock.mock.calls[0][0]).toContain('21m00Tcm4TlvDq8ikWAM');
    expect(fetchMock.mock.calls[0][1].headers['xi-api-key']).toBe('el-key');
  });

  it('uses a caller-supplied voiceId over the default', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => new ArrayBuffer(4),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const env = baseEnv({ ELEVENLABS_API_KEY: 'el-key' });
    await synthesizeSpeech(env, 'hi', 'custom-voice-99');
    expect(fetchMock.mock.calls[0][0]).toContain('custom-voice-99');
  });

  it('falls back to the default voice when voiceId is blank', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => new ArrayBuffer(4),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const env = baseEnv({ ELEVENLABS_API_KEY: 'el-key' });
    await synthesizeSpeech(env, 'hi', '   ');
    expect(fetchMock.mock.calls[0][0]).toContain('21m00Tcm4TlvDq8ikWAM');
  });

  it('returns a stub when ElevenLabs responds non-ok', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 429, headers: { get: () => null } });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const env = baseEnv({ ELEVENLABS_API_KEY: 'el-key' });
    const res = await synthesizeSpeech(env, 'hi');
    expect(res.provider).toBe('stub');
    expect(res.bytes.byteLength).toBe(0);
  });

  it('returns a stub when the ElevenLabs fetch throws', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const env = baseEnv({ ELEVENLABS_API_KEY: 'el-key' });
    const res = await synthesizeSpeech(env, 'hi');
    expect(res.provider).toBe('stub');
  });

  it('falls back the mime to audio/mpeg when the response omits content-type', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(2),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const env = baseEnv({ ELEVENLABS_API_KEY: 'el-key' });
    const res = await synthesizeSpeech(env, 'hi');
    expect(res.mime).toBe('audio/mpeg');
    expect(res.provider).toBe('elevenlabs');
  });
});
