/**
 * @module services/image_optimization
 * @description WASM-powered image optimization pipeline for the Worker.
 *
 * Takes DALL-E PNG output (or any PNG/JPEG ArrayBuffer) and produces the
 * AVIF + WebP + resized-PNG triplet mandated by quality-metrics.md, all
 * stored to R2 as siblings of the original key.
 *
 * Codecs and WASM modules are lazy-loaded on first use via dynamic `import()`
 * so the worker's cold-start path for non-image traffic stays untouched and
 * Jest's Node environment can statically import this module without trying to
 * evaluate Emscripten codecs.
 *
 * @see ~/.agentskills/quality-metrics.md (AVIF mandate)
 * @see services/build_validators.ts (image.png_too_large gate this closes)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Env } from '../types/env.js';

interface Codecs {
  decodePng: (b: ArrayBuffer) => Promise<any>;
  decodeJpeg: (b: ArrayBuffer) => Promise<any>;
  encodeAvif: (img: any, opts: any) => Promise<ArrayBuffer>;
  encodeWebp: (img: any, opts: any) => Promise<ArrayBuffer>;
  encodePng: (img: any) => Promise<ArrayBuffer>;
  resize: (img: any, opts: any) => Promise<any>;
}

let codecsReady: Promise<Codecs> | null = null;

async function loadCodecs(): Promise<Codecs> {
  if (codecsReady) return codecsReady;
  codecsReady = (async () => {
    const [
      { default: decodePng },
      { default: decodeJpeg },
      avifMod,
      webpMod,
      { default: encodePng },
      resizeMod,
      { default: avifEncWasm },
      { default: webpEncWasm },
      { default: resizeWasm },
    ] = await Promise.all([
      import('@jsquash/png/decode'),
      import('@jsquash/jpeg/decode'),
      import('@jsquash/avif/encode'),
      import('@jsquash/webp/encode'),
      import('@jsquash/png/encode'),
      import('@jsquash/resize'),
      // Wrangler resolves these as WebAssembly.Module at bundle time; Jest stubs
      // them via moduleNameMapper.
      import('@jsquash/avif/codec/enc/avif_enc.wasm' as any),
      import('@jsquash/webp/codec/enc/webp_enc.wasm' as any),
      import('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm' as any),
    ]);
    const { init: initAvif, default: encodeAvif } = avifMod;
    const { init: initWebp, default: encodeWebp } = webpMod;
    const { default: resize, initResize } = resizeMod;

    await Promise.all([
      initAvif(avifEncWasm as unknown as WebAssembly.Module),
      // WebP's init signature differs: it takes module-option overrides, not the
      // wasm module directly. Wrangler's bundler resolves the dynamic codec
      // import inside the WebP encoder using the bundled webp_enc.wasm.
      initWebp(),
      initResize(resizeWasm as unknown as WebAssembly.Module),
    ]);

    return { decodePng, decodeJpeg, encodeAvif, encodeWebp, encodePng, resize };
  })();
  return codecsReady;
}

const MAX_WIDTH_DEFAULT = 1600;
// AVIF cqLevel: 0 = lossless / huge, 63 = grainy. 22 ≈ visually-lossless web hero.
const AVIF_CQ_LEVEL = 22;
const AVIF_SPEED = 6; // 0=slow/best, 10=fast/worst. 6 = balanced.
const WEBP_QUALITY = 80;

export interface OptimizedImage {
  /** Resized PNG fallback (kept for older browsers + Safari < 16). */
  png: ArrayBuffer;
  /** AVIF — primary. */
  avif: ArrayBuffer;
  /** WebP fallback. */
  webp: ArrayBuffer;
  /** Final image dimensions after any resize. */
  width: number;
  height: number;
  /** Original input dimensions (pre-resize). */
  sourceWidth: number;
  sourceHeight: number;
}

async function decodeBytes(bytes: ArrayBuffer): Promise<any> {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4));
  const isPng = head[0] === 0x89 && head[1] === 0x50;
  const isJpeg = head[0] === 0xff && head[1] === 0xd8;
  const codecs = await loadCodecs();
  if (isPng) return codecs.decodePng(bytes);
  if (isJpeg) return codecs.decodeJpeg(bytes);
  throw new Error('image_optimization: unsupported source format (expected PNG or JPEG)');
}

async function maybeResize(image: any, maxWidth: number): Promise<any> {
  if (image.width <= maxWidth) return image;
  const codecs = await loadCodecs();
  const ratio = maxWidth / image.width;
  const height = Math.round(image.height * ratio);
  return codecs.resize(image, { width: maxWidth, height, method: 'lanczos3' });
}

/**
 * Run the full optimization pipeline against a single image byte array.
 *
 * @param sourceBytes - Raw PNG or JPEG bytes (e.g. DALL-E output).
 * @param opts.maxWidth - Resize ceiling; defaults to 1600.
 * @param opts.avifCqLevel - AVIF constant-quality 0-63; defaults to 22.
 * @param opts.webpQuality - WebP quality 0-100; defaults to 80.
 */
export async function optimizeImage(
  sourceBytes: ArrayBuffer,
  opts: { maxWidth?: number; avifCqLevel?: number; webpQuality?: number } = {},
): Promise<OptimizedImage> {
  const maxWidth = opts.maxWidth ?? MAX_WIDTH_DEFAULT;
  const avifCq = opts.avifCqLevel ?? AVIF_CQ_LEVEL;
  const webpQ = opts.webpQuality ?? WEBP_QUALITY;

  const source = await decodeBytes(sourceBytes);
  const sourceWidth = source.width;
  const sourceHeight = source.height;

  const resized = await maybeResize(source, maxWidth);
  const codecs = await loadCodecs();

  const [avifBuf, webpBuf, pngBuf] = await Promise.all([
    codecs.encodeAvif(resized, { cqLevel: avifCq, speed: AVIF_SPEED }),
    codecs.encodeWebp(resized, { quality: webpQ }),
    codecs.encodePng(resized),
  ]);

  return {
    avif: avifBuf,
    webp: webpBuf,
    png: pngBuf,
    width: resized.width,
    height: resized.height,
    sourceWidth,
    sourceHeight,
  };
}

export interface StoredImageVariants {
  avifKey: string;
  webpKey: string;
  pngKey: string;
  sizes: { avif: number; webp: number; png: number };
  width: number;
  height: number;
}

/**
 * Optimize and store the AVIF + WebP + PNG triplet to R2.
 *
 * @param env - Worker env (needs `SITES_BUCKET`).
 * @param baseKey - Key without extension, e.g. `sites/foo/assets/hero`. The
 *                  three variants land at `${baseKey}.avif`, `.webp`, `.png`.
 * @param sourceBytes - DALL-E PNG output (or any PNG/JPEG bytes).
 * @param meta - Optional custom metadata persisted to each R2 object.
 */
export async function optimizeAndStoreToR2(
  env: Env,
  baseKey: string,
  sourceBytes: ArrayBuffer,
  meta: { source?: string; confidence?: string; prompt?: string } = {},
  opts: { maxWidth?: number; avifCqLevel?: number; webpQuality?: number } = {},
): Promise<StoredImageVariants> {
  const optimized = await optimizeImage(sourceBytes, opts);

  const avifKey = `${baseKey}.avif`;
  const webpKey = `${baseKey}.webp`;
  const pngKey = `${baseKey}.png`;

  const customMetadata: Record<string, string> = {
    source: meta.source ?? 'optimized',
    confidence: meta.confidence ?? '85',
    width: String(optimized.width),
    height: String(optimized.height),
  };
  if (meta.prompt) customMetadata.prompt = meta.prompt.substring(0, 200);

  await Promise.all([
    env.SITES_BUCKET.put(avifKey, optimized.avif, {
      httpMetadata: { contentType: 'image/avif', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { ...customMetadata, format: 'avif' },
    }),
    env.SITES_BUCKET.put(webpKey, optimized.webp, {
      httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { ...customMetadata, format: 'webp' },
    }),
    env.SITES_BUCKET.put(pngKey, optimized.png, {
      httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { ...customMetadata, format: 'png' },
    }),
  ]);

  return {
    avifKey,
    webpKey,
    pngKey,
    sizes: {
      avif: optimized.avif.byteLength,
      webp: optimized.webp.byteLength,
      png: optimized.png.byteLength,
    },
    width: optimized.width,
    height: optimized.height,
  };
}
