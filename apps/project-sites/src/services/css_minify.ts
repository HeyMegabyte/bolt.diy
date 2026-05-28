/**
 * @module services/css_minify
 * @description WASM-powered CSS minify-on-serve with KV caching.
 *
 * Sits in front of any R2 CSS asset served by `site_serving.ts`. Each unique
 * CSS payload is minified once via `lightningcss-wasm` (autoprefix to modern
 * baseline + drop unused fallbacks + minify whitespace) and the result is
 * cached in `CACHE_KV` keyed by SHA-256 of the source. Subsequent requests
 * skip WASM entirely.
 *
 * Lazy-loads the 15 MB WASM module on first call to keep cold-starts for
 * non-CSS traffic unaffected.
 *
 * @see ~/.agentskills/quality-metrics.md (CSS budget gate)
 */

import type { Env } from '../types/env.js';

let transformer: Promise<(opts: TransformOptions) => TransformResult> | null = null;

interface TransformOptions {
  filename: string;
  code: Uint8Array;
  minify: boolean;
  sourceMap?: boolean;
  targets?: unknown;
}

interface TransformResult {
  code: Uint8Array;
  warnings?: { message: string }[];
}

/** Minimum browser targets — auto-prefix anything older. */
const TARGETS = {
  // Encoded per lightningcss browserslist format: bits 0-7 patch, 8-15 minor, 16-23 major.
  // We pin: Chrome 110, Edge 110, Safari 16, Firefox 110, iOS Safari 16. Covers Baseline 2023.
  chrome: 110 << 16,
  edge: 110 << 16,
  safari: (16 << 16) | (0 << 8),
  firefox: 110 << 16,
  ios_saf: (16 << 16) | (0 << 8),
};

async function getTransformer(): Promise<(opts: TransformOptions) => TransformResult> {
  if (transformer) return transformer;
  transformer = (async () => {
    // lightningcss-wasm exports a default async init() in the browser/Workers path,
    // followed by sync `transform()`. The module shape is: { default: init, transform }
    const mod = await import('lightningcss-wasm') as {
      default?: () => Promise<void>;
      transform: (opts: TransformOptions) => TransformResult;
    };
    if (typeof mod.default === 'function') {
      await mod.default();
    }
    return mod.transform;
  })();
  return transformer;
}

async function sha256Hex(input: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', input);
  const view = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Minify a CSS source. Returns the minified bytes alongside compression stats.
 * On any error, returns the original bytes unchanged + logs a warning — never
 * blocks the serve path.
 *
 * @param source - Raw CSS bytes (text decode happens internally).
 * @param filename - For lightningcss warning attribution (e.g. `app.css`).
 */
export async function minifyCss(
  source: ArrayBuffer,
  filename = 'input.css',
): Promise<{ bytes: ArrayBuffer; originalSize: number; minifiedSize: number; ok: boolean }> {
  const originalSize = source.byteLength;
  try {
    const transform = await getTransformer();
    const result = transform({
      filename,
      code: new Uint8Array(source),
      minify: true,
      sourceMap: false,
      targets: TARGETS,
    });
    const out = result.code.buffer.slice(
      result.code.byteOffset,
      result.code.byteOffset + result.code.byteLength,
    ) as ArrayBuffer;
    return { bytes: out, originalSize, minifiedSize: out.byteLength, ok: true };
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'css_minify',
        action: 'transform_failed',
        filename,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { bytes: source, originalSize, minifiedSize: originalSize, ok: false };
  }
}

/**
 * Minify with KV cache. Hot path: KV hit returns immediately, no WASM init.
 *
 * Cache key format: `css:min:{sha256-hex}`. Stored as raw bytes. TTL 30 days
 * (CSS at a versioned R2 path is immutable — safe to cache long).
 */
export async function minifyCssCached(
  env: Env,
  source: ArrayBuffer,
  filename = 'input.css',
): Promise<{ bytes: ArrayBuffer; cacheHit: boolean }> {
  const kv = env.CACHE_KV;
  if (!kv) {
    const { bytes } = await minifyCss(source, filename);
    return { bytes, cacheHit: false };
  }
  const hash = await sha256Hex(source);
  const cacheKey = `css:min:${hash}`;
  const cached = await kv.get(cacheKey, 'arrayBuffer');
  if (cached) {
    return { bytes: cached, cacheHit: true };
  }
  const { bytes, ok } = await minifyCss(source, filename);
  if (ok) {
    // Fire-and-forget cache write; expire in 30 days.
    try {
      await kv.put(cacheKey, bytes, { expirationTtl: 60 * 60 * 24 * 30 });
    } catch (err) {
      console.warn('[css_minify] KV cache write failed:', err);
    }
  }
  return { bytes, cacheHit: false };
}
