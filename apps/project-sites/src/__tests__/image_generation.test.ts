/**
 * Unit coverage for services/image_generation.ts (convergence r18).
 *
 * Covers the SERVICE surface (callDallE3, generateLogo, generateSectionImage,
 * generateFaviconSet, generateWebsiteImages + the buildPngIco helper exercised
 * through generateFaviconSet) — distinct from workflows-image-generation.test.ts
 * which exercises the WORKFLOW (workflows/image-generation.ts).
 *
 * jSquash WASM never runs here: optimizeAndStoreToR2 is mocked so we test
 * image_generation's own branching (provider key gating, OpenAI HTTP success/
 * error/throw, R2 fallback when optimization fails, size/format params, edge
 * inputs) in isolation.
 */

// Mock the optimization dependency so jSquash WASM never loads in Jest.
jest.mock('../services/image_optimization.js', () => ({
  __esModule: true,
  optimizeAndStoreToR2: jest.fn(),
}));

import { optimizeAndStoreToR2 } from '../services/image_optimization.js';
import {
  callDallE3,
  generateLogo,
  generateSectionImage,
  generateFaviconSet,
  generateWebsiteImages,
} from '../services/image_generation';
import type { Env } from '../types/env.js';

const mockOptimize = optimizeAndStoreToR2 as unknown as jest.Mock;

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
  const fetchMock = jest.fn(
    async (input: RequestInfo | URL) => {
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
    },
  );
  return fetchMock;
}

const VARIANTS = {
  avifKey: 'base.avif',
  webpKey: 'base.webp',
  pngKey: 'base.png',
  sizes: { avif: 11, webp: 22, png: 33 },
};

describe('image_generation service', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockOptimize.mockResolvedValue(VARIANTS);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // ---- callDallE3 ----------------------------------------------------------

  describe('callDallE3', () => {
    it('returns null and warns when OPENAI_API_KEY is unset', async () => {
      const env = makeEnv({ OPENAI_API_KEY: undefined });
      const result = await callDallE3(env, 'a prompt');
      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('OPENAI_API_KEY not set'),
      );
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
      expect(body.prompt).toBe('hero prompt');
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer sk-test-key',
      });
    });

    it('defaults size to 1024x1024 when omitted', async () => {
      const fetchMock = stubDallE3Success();
      global.fetch = fetchMock as unknown as typeof fetch;
      await callDallE3(makeEnv(), 'p');
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.size).toBe('1024x1024');
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

    it('returns null and warns when fetch throws (network resilience)', async () => {
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

  // ---- generateLogo --------------------------------------------------------

  describe('generateLogo', () => {
    const brand = {
      primary_color: '#0af',
      accent_color: '#f0a',
      font_heading: 'Sora',
      personality: 'bold',
    };

    it('returns null when image generation yields nothing', async () => {
      const env = makeEnv({ OPENAI_API_KEY: undefined });
      expect(await generateLogo(env, 'acme', 'Acme', 'retail', brand)).toBeNull();
      expect(mockOptimize).not.toHaveBeenCalled();
    });

    it('optimizes + stores the logo and returns AVIF-first metadata', async () => {
      global.fetch = stubDallE3Success() as unknown as typeof fetch;
      const result = await generateLogo(makeEnv(), 'acme', 'Acme', 'retail', brand);
      expect(mockOptimize).toHaveBeenCalledWith(
        expect.anything(),
        'sites/acme/assets/logo',
        expect.any(ArrayBuffer),
        expect.objectContaining({ source: 'generated', confidence: '85' }),
      );
      expect(result).toMatchObject({
        key: 'base.avif',
        name: 'logo.avif',
        type: 'image/avif',
        confidence: 85,
        source: 'generated',
        variants: { avifKey: 'base.avif', webpKey: 'base.webp', pngKey: 'base.png' },
      });
    });

    it('builds a prompt that omits empty brand fields', async () => {
      global.fetch = stubDallE3Success() as unknown as typeof fetch;
      await generateLogo(makeEnv(), 'acme', 'Acme', 'cafe', {});
      const promptArg = mockOptimize.mock.calls[0][3].prompt as string;
      expect(promptArg).toContain('Acme');
      expect(promptArg).toContain('cafe');
      expect(promptArg).not.toContain('Primary color:');
      expect(promptArg).not.toContain('Accent color:');
      expect(promptArg).not.toContain('font style');
    });

    it('falls back to a raw PNG R2 put when optimization throws', async () => {
      global.fetch = stubDallE3Success(new ArrayBuffer(256)) as unknown as typeof fetch;
      mockOptimize.mockRejectedValueOnce(new Error('wasm boom'));
      const env = makeEnv();
      const result = await generateLogo(env, 'acme', 'Acme', 'retail', brand);
      expect(result).toMatchObject({
        key: 'sites/acme/assets/logo.png',
        name: 'logo.png',
        type: 'image/png',
        size: 256,
        confidence: 85,
      });
      const bucket = env.SITES_BUCKET as unknown as ReturnType<typeof makeBucket>;
      expect(bucket.put).toHaveBeenCalledWith(
        'sites/acme/assets/logo.png',
        expect.any(ArrayBuffer),
        expect.objectContaining({ httpMetadata: { contentType: 'image/png' } }),
      );
    });
  });

  // ---- generateSectionImage ------------------------------------------------

  describe('generateSectionImage', () => {
    it('returns null when generation fails', async () => {
      const env = makeEnv({ OPENAI_API_KEY: undefined });
      expect(await generateSectionImage(env, 's', 'hero', 'p')).toBeNull();
    });

    it('sanitizes the image name into the R2 key and stores AVIF-first', async () => {
      global.fetch = stubDallE3Success() as unknown as typeof fetch;
      const result = await generateSectionImage(makeEnv(), 'shop', 'Hero Banner!@#', 'a prompt');
      expect(mockOptimize).toHaveBeenCalledWith(
        expect.anything(),
        'sites/shop/assets/generated/Hero_Banner___',
        expect.any(ArrayBuffer),
        expect.objectContaining({ source: 'generated', confidence: '75' }),
        expect.objectContaining({ maxWidth: 1792 }),
      );
      expect(result?.name).toBe('Hero_Banner___.avif');
      expect(result?.type).toBe('image/avif');
    });

    it('uses a 1024 maxWidth ceiling for square sizes', async () => {
      global.fetch = stubDallE3Success() as unknown as typeof fetch;
      await generateSectionImage(makeEnv(), 'shop', 'sq', 'p', '1024x1024');
      expect(mockOptimize).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.any(ArrayBuffer),
        expect.anything(),
        expect.objectContaining({ maxWidth: 1024 }),
      );
    });

    it('truncates very long image names to 60 chars', async () => {
      global.fetch = stubDallE3Success() as unknown as typeof fetch;
      const longName = 'a'.repeat(120);
      await generateSectionImage(makeEnv(), 'shop', longName, 'p');
      const key = mockOptimize.mock.calls[0][1] as string;
      const safe = key.split('/').pop() as string;
      expect(safe.length).toBe(60);
    });

    it('falls back to raw PNG when optimization throws', async () => {
      global.fetch = stubDallE3Success(new ArrayBuffer(99)) as unknown as typeof fetch;
      mockOptimize.mockRejectedValueOnce(new Error('boom'));
      const env = makeEnv();
      const result = await generateSectionImage(env, 'shop', 'hero', 'p');
      expect(result).toMatchObject({
        key: 'sites/shop/assets/generated/hero.png',
        type: 'image/png',
        size: 99,
        confidence: 75,
      });
    });
  });

  // ---- generateFaviconSet (exercises buildPngIco) --------------------------

  describe('generateFaviconSet', () => {
    it('writes icon-512, manifest, browserconfig, and a PNG-wrapped favicon.ico', async () => {
      const env = makeEnv();
      const source = new ArrayBuffer(40);
      const results = await generateFaviconSet(env, 'my-shop', source);

      const names = results.map((r) => r.name);
      expect(names).toEqual([
        'icon-512.png',
        'site.webmanifest',
        'browserconfig.xml',
        'favicon.ico',
      ]);

      const bucket = env.SITES_BUCKET as unknown as ReturnType<typeof makeBucket>;
      const keys = bucket.puts.map((p) => p.key);
      expect(keys).toContain('sites/my-shop/assets/icon-512.png');
      expect(keys).toContain('sites/my-shop/assets/site.webmanifest');
      expect(keys).toContain('sites/my-shop/assets/browserconfig.xml');
      expect(keys).toContain('sites/my-shop/assets/favicon.ico');

      // ICO is 6-byte header + 16-byte dir entry + the PNG payload.
      const ico = results.find((r) => r.name === 'favicon.ico');
      expect(ico?.size).toBe(6 + 16 + 40);
      expect(ico?.type).toBe('image/x-icon');
    });

    it('derives manifest name/short_name from the slug (dashes → spaces)', async () => {
      const env = makeEnv();
      await generateFaviconSet(env, 'lake-hiawatha-cafe', new ArrayBuffer(8));
      const bucket = env.SITES_BUCKET as unknown as ReturnType<typeof makeBucket>;
      const manifestPut = bucket.puts.find((p) => p.key.endsWith('site.webmanifest'));
      const manifest = JSON.parse(manifestPut?.body as string);
      expect(manifest.name).toBe('lake hiawatha cafe');
      expect(manifest.short_name).toBe('lake hiawatha cafe');
      expect(manifest.icons).toHaveLength(2);
    });

    it('all favicon assets carry source=generated', async () => {
      const results = await generateFaviconSet(makeEnv(), 's', new ArrayBuffer(8));
      expect(results.every((r) => r.source === 'generated')).toBe(true);
    });
  });

  // ---- generateWebsiteImages -----------------------------------------------

  describe('generateWebsiteImages', () => {
    it('caps generation at MAX_GENERATED_IMAGES and skips failed generations', async () => {
      // First image generates fine; second returns null (no key) — simulate via fetch failing on 2nd.
      let call = 0;
      global.fetch = jest.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.openai.com')) {
          call += 1;
          if (call === 2) return { ok: false, status: 500, text: async () => 'err' } as unknown as Response;
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: [{ url: 'https://img/x.png' }] }),
          } as unknown as Response;
        }
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) } as unknown as Response;
      }) as unknown as typeof fetch;

      const env = makeEnv({ MAX_GENERATED_IMAGES: '2' });
      const needs = [
        { concept: 'hero', prompt: 'hero shot' },
        { concept: 'team', prompt: 'team shot' },
        { concept: 'extra', prompt: 'extra — should be sliced off' },
      ];
      const results = await generateWebsiteImages(env, 'shop', 'Acme', 'retail', needs);
      // Only 2 attempted (cap), 1 succeeded (2nd failed) → length 1.
      expect(results).toHaveLength(1);
      // 'extra' was sliced off before any generation.
      expect(call).toBe(2);
    });

    it('defaults the cap to 5 when MAX_GENERATED_IMAGES is unset', async () => {
      global.fetch = stubDallE3Success() as unknown as typeof fetch;
      const env = makeEnv(); // no MAX_GENERATED_IMAGES
      const needs = Array.from({ length: 7 }, (_, i) => ({ concept: `c${i}`, prompt: `p${i}` }));
      const results = await generateWebsiteImages(env, 'shop', 'Acme', 'retail', needs);
      expect(results).toHaveLength(5);
    });

    it('returns an empty array for empty image needs', async () => {
      global.fetch = stubDallE3Success() as unknown as typeof fetch;
      const results = await generateWebsiteImages(makeEnv(), 'shop', 'Acme', 'retail', []);
      expect(results).toEqual([]);
    });

    it('embeds business name + type into the composed prompt', async () => {
      global.fetch = stubDallE3Success() as unknown as typeof fetch;
      await generateWebsiteImages(makeEnv(), 'shop', 'Acme Co', 'bakery', [
        { concept: 'hero', prompt: 'warm croissants' },
      ]);
      const prompt = mockOptimize.mock.calls[0][3].prompt as string;
      expect(prompt).toContain('warm croissants');
      expect(prompt).toContain('Acme Co');
      expect(prompt).toContain('bakery');
    });
  });
});
