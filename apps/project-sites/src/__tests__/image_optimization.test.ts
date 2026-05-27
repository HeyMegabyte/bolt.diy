/**
 * Surface-level tests for image_optimization that don't require the WASM
 * encoders to actually run inside Jest. Encoder behavior is verified by
 * production E2E (Playwright fetch of `.avif`/`.webp` siblings after a build).
 */

// Mock the jSquash modules — Jest can't load Emscripten WASM in Node.
jest.mock('@jsquash/png/decode', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@jsquash/jpeg/decode', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@jsquash/avif/encode', () => ({
  __esModule: true,
  default: jest.fn(),
  init: jest.fn().mockResolvedValue({}),
}));
jest.mock('@jsquash/webp/encode', () => ({
  __esModule: true,
  default: jest.fn(),
  init: jest.fn().mockResolvedValue({}),
}));
jest.mock('@jsquash/png/encode', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@jsquash/resize', () => ({
  __esModule: true,
  default: jest.fn(),
  initResize: jest.fn().mockResolvedValue({}),
}));

import decodePng from '@jsquash/png/decode';
import encodeAvif from '@jsquash/avif/encode';
import encodeWebp from '@jsquash/webp/encode';
import encodePng from '@jsquash/png/encode';
import resizeFn from '@jsquash/resize';
import { optimizeImage, optimizeAndStoreToR2 } from '../services/image_optimization';

const mockDecodePng = decodePng as jest.MockedFunction<typeof decodePng>;
const mockEncodeAvif = encodeAvif as jest.MockedFunction<typeof encodeAvif>;
const mockEncodeWebp = encodeWebp as jest.MockedFunction<typeof encodeWebp>;
const mockEncodePng = encodePng as jest.MockedFunction<typeof encodePng>;
const mockResize = resizeFn as jest.MockedFunction<typeof resizeFn>;

function makePngHeader(): ArrayBuffer {
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  const buf = new ArrayBuffer(8);
  const view = new Uint8Array(buf);
  view.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return buf;
}

function makeJpegHeader(): ArrayBuffer {
  // JPEG magic: FF D8 FF
  const buf = new ArrayBuffer(4);
  const view = new Uint8Array(buf);
  view.set([0xff, 0xd8, 0xff, 0xe0]);
  return buf;
}

describe('image_optimization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mocks: small input, no resize needed, fake encoded output bytes.
    mockDecodePng.mockResolvedValue({ width: 1024, height: 768, data: new Uint8ClampedArray(0) } as never);
    mockEncodeAvif.mockResolvedValue(new ArrayBuffer(100));
    mockEncodeWebp.mockResolvedValue(new ArrayBuffer(200));
    mockEncodePng.mockResolvedValue(new ArrayBuffer(400));
    mockResize.mockResolvedValue({ width: 800, height: 600, data: new Uint8ClampedArray(0) } as never);
  });

  it('decodes PNG by magic bytes and skips resize when source ≤ maxWidth', async () => {
    const result = await optimizeImage(makePngHeader(), { maxWidth: 1600 });
    expect(mockDecodePng).toHaveBeenCalled();
    expect(mockResize).not.toHaveBeenCalled();
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
    expect(result.avif.byteLength).toBe(100);
    expect(result.webp.byteLength).toBe(200);
    expect(result.png.byteLength).toBe(400);
  });

  it('resizes when source exceeds maxWidth, preserving aspect ratio', async () => {
    mockDecodePng.mockResolvedValue({ width: 3200, height: 1800, data: new Uint8ClampedArray(0) } as never);
    mockResize.mockResolvedValue({ width: 1600, height: 900, data: new Uint8ClampedArray(0) } as never);
    const result = await optimizeImage(makePngHeader(), { maxWidth: 1600 });
    expect(mockResize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 3200, height: 1800 }),
      expect.objectContaining({ width: 1600, height: 900, method: 'lanczos3' }),
    );
    expect(result.width).toBe(1600);
    expect(result.height).toBe(900);
    expect(result.sourceWidth).toBe(3200);
    expect(result.sourceHeight).toBe(1800);
  });

  it('routes JPEG sources through the JPEG decoder', async () => {
    const decodeJpeg = (await import('@jsquash/jpeg/decode')).default as jest.MockedFunction<
      (b: ArrayBuffer) => Promise<unknown>
    >;
    decodeJpeg.mockResolvedValue({ width: 1024, height: 768, data: new Uint8ClampedArray(0) });
    await optimizeImage(makeJpegHeader());
    expect(decodeJpeg).toHaveBeenCalled();
  });

  it('rejects unsupported source formats', async () => {
    const garbage = new ArrayBuffer(4);
    new Uint8Array(garbage).set([0xde, 0xad, 0xbe, 0xef]);
    await expect(optimizeImage(garbage)).rejects.toThrow(/unsupported source format/);
  });

  it('optimizeAndStoreToR2 writes all three variants with correct content-types', async () => {
    const puts: { key: string; ct?: string; format?: string }[] = [];
    const env = {
      SITES_BUCKET: {
        put: jest.fn(async (key: string, _body: unknown, opts: { httpMetadata?: { contentType?: string }; customMetadata?: { format?: string } }) => {
          puts.push({ key, ct: opts.httpMetadata?.contentType, format: opts.customMetadata?.format });
        }),
      },
    } as unknown as Parameters<typeof optimizeAndStoreToR2>[0];

    const result = await optimizeAndStoreToR2(env, 'sites/foo/assets/hero', makePngHeader(), {
      source: 'generated',
      confidence: '85',
      prompt: 'A test hero shot',
    });

    expect(result.avifKey).toBe('sites/foo/assets/hero.avif');
    expect(result.webpKey).toBe('sites/foo/assets/hero.webp');
    expect(result.pngKey).toBe('sites/foo/assets/hero.png');
    expect(puts).toHaveLength(3);
    expect(puts.find((p) => p.key.endsWith('.avif'))?.ct).toBe('image/avif');
    expect(puts.find((p) => p.key.endsWith('.webp'))?.ct).toBe('image/webp');
    expect(puts.find((p) => p.key.endsWith('.png'))?.ct).toBe('image/png');
  });
});
