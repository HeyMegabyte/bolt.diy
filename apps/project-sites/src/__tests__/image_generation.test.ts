/**
 * Unit coverage for services/image_generation.ts.
 *
 * Covers the sole SERVICE export `callDallE3` — provider-key gating, OpenAI HTTP
 * success/error/throw, missing-url handling, size/default params, and the
 * time-boxed follow-up image download. Distinct from workflows-image-generation.test.ts
 * (the async workflow that superseded the removed synchronous logo/section/favicon helpers).
 */

import { callDallE3 } from '../services/image_generation';
import type { Env } from '../types/env.js';

/** A minimal R2-put recorder usable as env.SITES_BUCKET. */
function makeBucket() {
  const puts: { key: string; body: unknown; opts: Record<string, unknown> }[] = [];
  const put = jest.fn(async (key: string, body: unknown, opts: Record<string, unknown> = {}) => {
    puts.push({ key, body, opts });
  });
  return { put, puts };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  const bucket = makeBucket();
  return {
    OPENAI_API_KEY: 'sk-test-key',
    SITES_BUCKET: bucket as unknown,
    ...overrides,
  } as unknown as Env;
}

/** Build a successful DALL-E generations JSON response + the follow-up image bytes. */
function stubDallE3Success(imageBytes = new ArrayBuffer(64)) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('api.openai.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ url: 'https://img.example.com/generated.png' }] }),
        text: async () => '',
      } as unknown as Response;
    }
    // Image fetch
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => imageBytes,
    } as unknown as Response;
  });
  return fetchMock;
}

describe('image_generation service', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('callDallE3', () => {
    it('returns null and warns when OPENAI_API_KEY is unset', async () => {
      const env = makeEnv({ OPENAI_API_KEY: undefined });
      const result = await callDallE3(env, 'a prompt');
      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('OPENAI_API_KEY not set'));
    });

    it('returns null when OPENAI_API_KEY is an empty string', async () => {
      const env = makeEnv({ OPENAI_API_KEY: '' });
      expect(await callDallE3(env, 'p')).toBeNull();
    });

    it('posts to OpenAI with the requested size and returns the fetched image bytes', async () => {
      const bytes = new ArrayBuffer(128);
      const fetchMock = stubDallE3Success(bytes);
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await callDallE3(makeEnv(), 'hero prompt', '1792x1024');
      expect(result).toBe(bytes);

      const [genUrl, init] = fetchMock.mock.calls[0];
      expect(genUrl).toBe('https://api.openai.com/v1/images/generations');
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe('dall-e-3');
      expect(body.size).toBe('1792x1024');
      // The prompt is art-directed into a supreme, ultra-realistic prompt: it
      // keeps the caller's cue AND inherits the photographic preamble + hero
      // framing (1792x1024 → hero slot) + the negative-prompt tail.
      expect(body.prompt).toContain('hero prompt');
      expect(body.prompt).toContain('35mm');
      expect(body.prompt).toContain('16:9 landscape');
      expect(body.prompt).toContain('no watermark');
      // Routed through gatewayFetch → headers arrive as a Headers instance.
      const sentHeaders = new Headers((init as RequestInit).headers);
      expect(sentHeaders.get('Authorization')).toBe('Bearer sk-test-key');
    });

    it('defaults size to 1024x1024 when omitted', async () => {
      const fetchMock = stubDallE3Success();
      global.fetch = fetchMock as unknown as typeof fetch;
      await callDallE3(makeEnv(), 'p');
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.size).toBe('1024x1024');
    });

    it('time-boxes the follow-up image download with an AbortSignal (fail-fast on a CDN hang)', async () => {
      const fetchMock = stubDallE3Success();
      global.fetch = fetchMock as unknown as typeof fetch;
      await callDallE3(makeEnv(), 'p');
      // The 2nd fetch is the image download (URL is NOT the OpenAI generations endpoint);
      // it must carry an abort signal so a stalled blob CDN can't hang the Worker.
      const imageCall = fetchMock.mock.calls.find(([u]) => !String(u).includes('api.openai.com'));
      expect(imageCall).toBeTruthy();
      const init = imageCall?.[1] as RequestInit | undefined;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('returns null and warns on a non-200 generations response', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      })) as unknown as typeof fetch;
      global.fetch = fetchMock;
      const result = await callDallE3(makeEnv(), 'p');
      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('429'));
    });

    it('returns null when the generations payload has no image url', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      })) as unknown as typeof fetch;
      global.fetch = fetchMock;
      expect(await callDallE3(makeEnv(), 'p')).toBeNull();
    });

    it('returns null when the data array is missing entirely', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      })) as unknown as typeof fetch;
      global.fetch = fetchMock;
      expect(await callDallE3(makeEnv(), 'p')).toBeNull();
    });

    it('returns null when the follow-up image fetch is non-ok', async () => {
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.openai.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: [{ url: 'https://img.example.com/x.png' }] }),
          } as unknown as Response;
        }
        return { ok: false, status: 404 } as unknown as Response;
      }) as unknown as typeof fetch;
      global.fetch = fetchMock;
      expect(await callDallE3(makeEnv(), 'p')).toBeNull();
    });

    it('returns null and warns when fetch throws (network resilience / timeout)', async () => {
      const fetchMock = jest.fn(async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch;
      global.fetch = fetchMock;
      const result = await callDallE3(makeEnv(), 'p');
      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('DALL-E 3 call failed'),
        expect.any(Error),
      );
    });
  });
});
