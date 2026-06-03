/**
 * multimodal_intent — AI intent extractor for the Multimodal Site Copilot.
 *
 * The service fuses text + audio (Whisper STT via `env.AI.run`) + image
 * (GPT-4o vision via global `fetch`) into a single intent classification
 * (Workers AI Llama 3.3 70B via `env.AI.run`), returns extracted form fields +
 * a suggested route, and can persist a session row to D1. This suite locks the
 * contract directly — every AI / vision / fetch / D1 call is mocked, no real
 * APIs are hit — and exercises:
 *   1. processMultimodalIntent — text-only happy path, audio-only (Whisper
 *      transcript fused), image-only (vision description fused), all-three
 *      fused, no-input default branch, invalid-intent → 'unknown' coercion,
 *      missing extracted_fields/suggested_route defaults, markdown-wrapped JSON
 *      extraction, no-JSON-match fallback, JSON.parse-throw fallback,
 *      Whisper-throw resilience, vision no-key short-circuit, vision non-ok
 *      response, vision fetch-throw resilience, image MIME sniffing branches,
 *      latency object shape.
 *   2. saveCopilotSession — INSERT bind argument mapping (has_text/audio/image
 *      flags, JSON.stringify(extracted_fields), null coalescing), returns a
 *      UUID, swallows a DB failure (.catch) without throwing.
 *
 * ts-jest: GLOBAL `jest` (no @jest/globals import). All I/O mocked; no real APIs.
 */
import {
  processMultimodalIntent,
  saveCopilotSession,
  type MultimodalInput,
  type CopilotResult,
} from '../services/multimodal_intent.js';
import type { Env } from '../types/env.js';

// ─── env builders ──────────────────────────────────────────────────────────

let aiRunMock: jest.Mock;
let dbRunMock: jest.Mock;
let dbBindMock: jest.Mock;
let dbPrepareMock: jest.Mock;

/**
 * Build an Env whose `AI.run` is a single mock that dispatches by model id:
 * Whisper (`@cf/openai/whisper-tiny-en`) vs Llama classifier.
 */
const makeEnv = (opts: { openaiKey?: string } = {}): Env => {
  aiRunMock = jest.fn();
  dbRunMock = jest.fn(() => ({ catch: (fn: () => unknown) => Promise.resolve().then(fn) }));
  dbBindMock = jest.fn(() => ({ run: dbRunMock }));
  dbPrepareMock = jest.fn(() => ({ bind: dbBindMock }));
  return {
    OPENAI_API_KEY: opts.openaiKey,
    AI: { run: aiRunMock },
    DB: { prepare: dbPrepareMock },
  } as unknown as Env;
};

/** Llama classifier OK response carrying a raw JSON string. */
const classifyResponse = (raw: string) => ({ response: raw });
/** Whisper STT OK response. */
const whisperResponse = (text: string) => ({ text });

/** Default vision OK response with a description. */
const okVision = (content: string): Response =>
  ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }) as unknown as Response;

const originalFetch = global.fetch;
let fetchMock: jest.Mock;

const baseInput = (over: Partial<MultimodalInput> = {}): MultimodalInput => ({
  siteSlug: 'acme-roofing',
  orgId: 'org_1',
  siteId: 'site_1',
  ...over,
});

/** Route every AI.run mock to a valid classifier result unless overridden. */
const defaultClassifyJson = JSON.stringify({
  intent: 'quote',
  extracted_fields: { service: 'roof repair' },
  suggested_route: '/quote',
});

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

// ─── processMultimodalIntent ─────────────────────────────────────────────────

describe('processMultimodalIntent', () => {
  it('classifies text-only input and returns extracted fields + route', async () => {
    const env = makeEnv();
    aiRunMock.mockResolvedValueOnce(classifyResponse(defaultClassifyJson));

    const result = await processMultimodalIntent(env, baseInput({ text: 'I need a quote for a roof repair' }));

    expect(result.intent).toBe('quote');
    expect(result.extracted_fields).toEqual({ service: 'roof repair' });
    expect(result.suggested_route).toBe('/quote');
    expect(result.transcript).toBeUndefined();
    expect(result.image_description).toBeUndefined();
    // only the classifier ran (no audio, no image)
    expect(aiRunMock).toHaveBeenCalledTimes(1);
    expect(aiRunMock.mock.calls[0][0]).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    // the visitor text is fused into the classifier prompt
    expect((aiRunMock.mock.calls[0][1] as { prompt: string }).prompt).toContain('I need a quote for a roof repair');
  });

  it('transcribes audio via Whisper and fuses the transcript into classification', async () => {
    const env = makeEnv();
    aiRunMock
      .mockResolvedValueOnce(whisperResponse('  book me for tuesday  ')) // whisper (trimmed)
      .mockResolvedValueOnce(classifyResponse(JSON.stringify({ intent: 'book', suggested_route: '/book' })));

    const result = await processMultimodalIntent(env, baseInput({ audio: new ArrayBuffer(8) }));

    expect(result.transcript).toBe('book me for tuesday');
    expect(result.intent).toBe('book');
    // whisper called with the model + a byte array body
    expect(aiRunMock.mock.calls[0][0]).toBe('@cf/openai/whisper-tiny-en');
    expect(Array.isArray((aiRunMock.mock.calls[0][1] as { audio: number[] }).audio)).toBe(true);
    // classifier prompt carries the transcript
    expect((aiRunMock.mock.calls[1][1] as { prompt: string }).prompt).toContain('book me for tuesday');
  });

  it('describes an image via vision and fuses the description into classification', async () => {
    const env = makeEnv({ openaiKey: 'sk-test' });
    fetchMock.mockResolvedValueOnce(okVision('A damaged roof with missing shingles.'));
    aiRunMock.mockResolvedValueOnce(classifyResponse(JSON.stringify({ intent: 'support', suggested_route: '/contact' })));

    // PNG magic bytes so detectMimeType returns image/png
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const result = await processMultimodalIntent(env, baseInput({ image: png }));

    expect(result.image_description).toBe('A damaged roof with missing shingles.');
    expect(result.intent).toBe('support');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0].content[1].image_url.url).toContain('data:image/png;base64,');
    // classifier prompt carries the description
    expect((aiRunMock.mock.calls[0][1] as { prompt: string }).prompt).toContain('A damaged roof with missing shingles.');
  });

  it('fuses all three signals (text + audio + image) into one classification', async () => {
    const env = makeEnv({ openaiKey: 'sk-test' });
    fetchMock.mockResolvedValueOnce(okVision('A leaking ceiling.'));
    aiRunMock
      .mockResolvedValueOnce(whisperResponse('water everywhere')) // whisper
      .mockResolvedValueOnce(classifyResponse(defaultClassifyJson)); // classify

    const jpg = new Uint8Array([0xff, 0xd8, 0x00, 0x00]).buffer;
    const result = await processMultimodalIntent(
      env,
      baseInput({ text: 'help', audio: new ArrayBuffer(4), image: jpg }),
    );

    const classifyPrompt = (aiRunMock.mock.calls[1][1] as { prompt: string }).prompt;
    expect(classifyPrompt).toContain('Text: help');
    expect(classifyPrompt).toContain('Voice transcript: water everywhere');
    expect(classifyPrompt).toContain('Image description: A leaking ceiling.');
    expect(result.transcript).toBe('water everywhere');
    expect(result.image_description).toBe('A leaking ceiling.');
  });

  it('sends "No input provided" to the classifier when nothing is supplied', async () => {
    const env = makeEnv();
    aiRunMock.mockResolvedValueOnce(classifyResponse(JSON.stringify({ intent: 'browse', suggested_route: '/' })));

    const result = await processMultimodalIntent(env, baseInput());

    expect((aiRunMock.mock.calls[0][1] as { prompt: string }).prompt).toContain('No input provided');
    expect(result.intent).toBe('browse');
  });

  it('coerces an out-of-vocabulary intent to "unknown"', async () => {
    const env = makeEnv();
    aiRunMock.mockResolvedValueOnce(classifyResponse(JSON.stringify({ intent: 'purchase', suggested_route: '/x' })));

    const result = await processMultimodalIntent(env, baseInput({ text: 'hi' }));

    expect(result.intent).toBe('unknown');
    expect(result.suggested_route).toBe('/x');
  });

  it('defaults extracted_fields to {} and suggested_route to /contact when omitted', async () => {
    const env = makeEnv();
    aiRunMock.mockResolvedValueOnce(classifyResponse(JSON.stringify({ intent: 'book' })));

    const result = await processMultimodalIntent(env, baseInput({ text: 'hi' }));

    expect(result.extracted_fields).toEqual({});
    expect(result.suggested_route).toBe('/contact');
    expect(result.intent).toBe('book');
  });

  it('extracts JSON embedded in markdown fences', async () => {
    const env = makeEnv();
    const wrapped = '```json\n' + JSON.stringify({ intent: 'support', suggested_route: '/contact' }) + '\n```';
    aiRunMock.mockResolvedValueOnce(classifyResponse(wrapped));

    const result = await processMultimodalIntent(env, baseInput({ text: 'broken' }));

    expect(result.intent).toBe('support');
  });

  it('falls back to unknown/contact when the classifier returns no JSON object', async () => {
    const env = makeEnv();
    aiRunMock.mockResolvedValueOnce(classifyResponse('Sorry, I cannot help with that.'));

    const result = await processMultimodalIntent(env, baseInput({ text: 'hi' }));

    expect(result.intent).toBe('unknown');
    expect(result.extracted_fields).toEqual({});
    expect(result.suggested_route).toBe('/contact');
  });

  it('falls back to unknown/contact when the classifier JSON is malformed', async () => {
    const env = makeEnv();
    aiRunMock.mockResolvedValueOnce(classifyResponse('{ intent: "book", bad json }'));

    const result = await processMultimodalIntent(env, baseInput({ text: 'hi' }));

    expect(result.intent).toBe('unknown');
    expect(result.suggested_route).toBe('/contact');
  });

  it('falls back to unknown when the classifier returns an empty/undefined response', async () => {
    const env = makeEnv();
    aiRunMock.mockResolvedValueOnce({}); // no `.response`

    const result = await processMultimodalIntent(env, baseInput({ text: 'hi' }));

    expect(result.intent).toBe('unknown');
  });

  it('survives a Whisper transcription throw (transcript empty, still classifies)', async () => {
    const env = makeEnv();
    aiRunMock
      .mockRejectedValueOnce(new Error('whisper down')) // whisper throws
      .mockResolvedValueOnce(classifyResponse(JSON.stringify({ intent: 'browse', suggested_route: '/' })));

    const result = await processMultimodalIntent(env, baseInput({ audio: new ArrayBuffer(2) }));

    expect(result.transcript).toBeUndefined(); // '' → undefined in output
    expect(result.intent).toBe('browse');
  });

  it('short-circuits vision (description empty) when OPENAI_API_KEY is absent', async () => {
    const env = makeEnv(); // no key
    aiRunMock.mockResolvedValueOnce(classifyResponse(JSON.stringify({ intent: 'browse', suggested_route: '/' })));

    const result = await processMultimodalIntent(env, baseInput({ image: new ArrayBuffer(4) }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.image_description).toBeUndefined();
    expect(result.latency.vision_ms).toBe(0);
  });

  it('returns empty description when the vision API responds non-ok', async () => {
    const env = makeEnv({ openaiKey: 'sk-test' });
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) } as unknown as Response);
    aiRunMock.mockResolvedValueOnce(classifyResponse(JSON.stringify({ intent: 'browse', suggested_route: '/' })));

    const result = await processMultimodalIntent(env, baseInput({ image: new ArrayBuffer(4) }));

    expect(result.image_description).toBeUndefined();
  });

  it('survives a vision fetch throw (description empty, still classifies)', async () => {
    const env = makeEnv({ openaiKey: 'sk-test' });
    fetchMock.mockRejectedValueOnce(new Error('network'));
    aiRunMock.mockResolvedValueOnce(classifyResponse(JSON.stringify({ intent: 'browse', suggested_route: '/' })));

    const result = await processMultimodalIntent(env, baseInput({ image: new ArrayBuffer(4) }));

    expect(result.image_description).toBeUndefined();
    expect(result.intent).toBe('browse');
  });

  it('detects GIF magic bytes and builds an image/gif data URL', async () => {
    const env = makeEnv({ openaiKey: 'sk-test' });
    fetchMock.mockResolvedValueOnce(okVision('a gif'));
    aiRunMock.mockResolvedValueOnce(classifyResponse(JSON.stringify({ intent: 'browse', suggested_route: '/' })));

    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38]).buffer; // "GIF8"
    await processMultimodalIntent(env, baseInput({ image: gif }));

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.messages[0].content[1].image_url.url).toContain('data:image/gif;base64,');
  });

  it('defaults unknown image bytes to image/jpeg', async () => {
    const env = makeEnv({ openaiKey: 'sk-test' });
    fetchMock.mockResolvedValueOnce(okVision('unknown'));
    aiRunMock.mockResolvedValueOnce(classifyResponse(JSON.stringify({ intent: 'browse', suggested_route: '/' })));

    const blob = new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer;
    await processMultimodalIntent(env, baseInput({ image: blob }));

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.messages[0].content[1].image_url.url).toContain('data:image/jpeg;base64,');
  });

  it('returns a fully-shaped latency object', async () => {
    const env = makeEnv();
    aiRunMock.mockResolvedValueOnce(classifyResponse(defaultClassifyJson));

    const result = await processMultimodalIntent(env, baseInput({ text: 'hi' }));

    expect(result.latency).toEqual(
      expect.objectContaining({
        whisper_ms: expect.any(Number),
        vision_ms: expect.any(Number),
        classify_ms: expect.any(Number),
        total_ms: expect.any(Number),
      }),
    );
  });

  it('omits empty transcript/description from the output when falsy', async () => {
    const env = makeEnv();
    aiRunMock
      .mockResolvedValueOnce(whisperResponse('')) // empty transcript
      .mockResolvedValueOnce(classifyResponse(defaultClassifyJson));

    const result = await processMultimodalIntent(env, baseInput({ audio: new ArrayBuffer(2) }));

    expect(result.transcript).toBeUndefined();
  });
});

// ─── saveCopilotSession ──────────────────────────────────────────────────────

describe('saveCopilotSession', () => {
  const makeResult = (over: Partial<CopilotResult> = {}): CopilotResult => ({
    intent: 'quote',
    extracted_fields: { service: 'roof', email: 'a@b.com' },
    suggested_route: '/quote',
    latency: { whisper_ms: 1, vision_ms: 2, classify_ms: 3, total_ms: 6 },
    ...over,
  });

  it('inserts a row, returns a UUID, and binds the correct columns', async () => {
    const env = makeEnv();
    const input = baseInput({ text: 'hi', audio: new ArrayBuffer(2), visitorId: 'v1', anonId: 'a1' });
    const result = makeResult({ transcript: 't', image_description: 'd' });

    const id = await saveCopilotSession(env, {
      orgId: 'org_1',
      siteId: 'site_1',
      siteSlug: 'acme',
      input,
      result,
    });

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(dbPrepareMock).toHaveBeenCalledTimes(1);
    const bound = dbBindMock.mock.calls[0];
    // has_text=1 (text present), has_audio=1, has_image=0
    expect(bound).toContain('org_1');
    expect(bound).toContain('site_1');
    expect(bound).toContain('acme');
    expect(bound).toContain('done');
    // extracted_fields serialized
    expect(bound).toContain(JSON.stringify(result.extracted_fields));
    // visitor/anon ids forwarded
    expect(bound).toContain('v1');
    expect(bound).toContain('a1');
    expect(dbRunMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces missing transcript/description/visitor/anon to null', async () => {
    const env = makeEnv();
    const result = makeResult(); // no transcript / image_description

    await saveCopilotSession(env, {
      orgId: 'org_1',
      siteId: 'site_1',
      siteSlug: 'acme',
      input: baseInput(),
      result,
    });

    const bound = dbBindMock.mock.calls[0];
    // transcript + image_description + visitorId + anonId → null
    const nullCount = bound.filter((v: unknown) => v === null).length;
    expect(nullCount).toBeGreaterThanOrEqual(4);
  });

  it('sets has_image/has_audio/has_text flags from input presence', async () => {
    const env = makeEnv();
    await saveCopilotSession(env, {
      orgId: 'o',
      siteId: 's',
      siteSlug: 'slug',
      input: baseInput({ image: new ArrayBuffer(4) }), // image only
      result: makeResult(),
    });

    const bound = dbBindMock.mock.calls[0] as unknown[];
    // positional: id, org, site, slug, has_text, has_audio, has_image, ...
    expect(bound[4]).toBe(0); // has_text
    expect(bound[5]).toBe(0); // has_audio
    expect(bound[6]).toBe(1); // has_image
  });

  it('swallows a DB run failure without throwing and still returns an id', async () => {
    const env = makeEnv();
    // .run() returns an object whose .catch resolves the rejection to null
    dbRunMock.mockReturnValueOnce({ catch: (fn: (e: unknown) => unknown) => Promise.resolve(fn(new Error('d1 down'))) });

    const id = await saveCopilotSession(env, {
      orgId: 'o',
      siteId: 's',
      siteSlug: 'slug',
      input: baseInput(),
      result: makeResult(),
    });

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});
