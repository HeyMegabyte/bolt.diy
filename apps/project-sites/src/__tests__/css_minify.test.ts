/**
 * Tests for the CSS minify cache layer. The lightningcss-wasm module itself
 * is mocked because Jest's Node environment can't instantiate the 15 MB
 * runtime WASM blob — actual minification correctness is verified by
 * production E2E against a deployed `.css` file.
 */

jest.mock('lightningcss-wasm', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(undefined),
  transform: jest.fn(),
}));

import { minifyCss, minifyCssCached } from '../services/css_minify';
import lightningInit, { transform } from 'lightningcss-wasm';

const mockInit = lightningInit as unknown as jest.MockedFunction<() => Promise<void>>;
const mockTransform = transform as unknown as jest.MockedFunction<(opts: unknown) => { code: Uint8Array }>;

const toBytes = (s: string) => new TextEncoder().encode(s).buffer;
const fromBytes = (b: ArrayBuffer) => new TextDecoder().decode(b);

describe('css_minify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInit.mockResolvedValue(undefined);
    mockTransform.mockImplementation(({ code }: { code: Uint8Array }) => ({
      code: new Uint8Array(new TextEncoder().encode(new TextDecoder().decode(code).replace(/\s+/g, ''))),
    }));
  });

  it('initializes the WASM module on first call and reuses it after', async () => {
    await minifyCss(toBytes('a { color: red; }'));
    await minifyCss(toBytes('b { color: blue; }'));
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it('returns minified bytes with shrink stats', async () => {
    const source = toBytes('  body  {  color :  red ;  }  ');
    const result = await minifyCss(source);
    expect(result.ok).toBe(true);
    expect(result.minifiedSize).toBeLessThan(result.originalSize);
    expect(fromBytes(result.bytes)).not.toMatch(/\s\s/);
  });

  it('falls through to original bytes when lightningcss throws', async () => {
    mockTransform.mockImplementation(() => {
      throw new Error('parse error');
    });
    const source = toBytes('invalid !!! css');
    const result = await minifyCss(source);
    expect(result.ok).toBe(false);
    expect(fromBytes(result.bytes)).toBe('invalid !!! css');
  });

  it('serves cached bytes on a KV hit and skips lightningcss', async () => {
    const cached = toBytes('cached{a:b}');
    const env = {
      CACHE_KV: {
        get: jest.fn(async () => cached),
        put: jest.fn(),
      },
    } as unknown as Parameters<typeof minifyCssCached>[0];

    const result = await minifyCssCached(env, toBytes('big css blob'));
    expect(result.cacheHit).toBe(true);
    expect(fromBytes(result.bytes)).toBe('cached{a:b}');
    expect(mockTransform).not.toHaveBeenCalled();
  });

  it('writes to KV on a cache miss', async () => {
    const env = {
      CACHE_KV: {
        get: jest.fn(async () => null),
        put: jest.fn(async () => undefined),
      },
    } as unknown as Parameters<typeof minifyCssCached>[0];

    await minifyCssCached(env, toBytes('h1{color:red}'));
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      expect.stringMatching(/^css:min:[0-9a-f]{64}$/),
      expect.any(ArrayBuffer),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it('skips KV entirely when CACHE_KV is unbound', async () => {
    const env = {} as unknown as Parameters<typeof minifyCssCached>[0];
    const result = await minifyCssCached(env, toBytes('a{b:c}'));
    expect(result.cacheHit).toBe(false);
    expect(mockTransform).toHaveBeenCalled();
  });
});
