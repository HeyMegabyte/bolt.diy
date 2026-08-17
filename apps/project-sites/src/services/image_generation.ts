/**
 * @module services/image_generation
 * @description OpenAI DALL-E 3 image generation.
 *
 * `callDallE3` generates a single PNG via the AI Gateway and returns its raw bytes.
 * Consumed by the media library's `generateImage` (`POST /api/media/generate/image`).
 *
 * @remarks
 * The legacy synchronous helpers (`generateLogo` / `generateSectionImage` /
 * `generateFaviconSet` / `generateWebsiteImages`) were removed once the async
 * `workflows/image-generation.ts` fully superseded them — see that workflow for the
 * current logo / section / favicon generation path.
 */

import type { Env } from '../types/env.js';
import { gatewayFetch } from './ai_gateway.js';

/**
 * Call OpenAI DALL-E 3 to generate an image.
 *
 * @returns The image as an ArrayBuffer (PNG) or null on failure.
 */
export async function callDallE3(
  env: Env,
  prompt: string,
  size: '1024x1024' | '1792x1024' | '1024x1792' = '1024x1024',
): Promise<ArrayBuffer | null> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[image_generation] OPENAI_API_KEY not set — skipping image generation');
    return null;
  }

  try {
    const { response: res } = await gatewayFetch(env, 'openai', '/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size,
        response_format: 'url',
        quality: 'standard',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(`[image_generation] DALL-E 3 error: ${res.status} ${err}`);
      return null;
    }

    const data = (await res.json()) as { data: { url: string }[] };
    const imageUrl = data.data?.[0]?.url;
    if (!imageUrl) return null;

    // Fetch the generated image. Time-boxed: DALL-E returns a short-lived blob-CDN URL,
    // and a bare fetch would hang the Worker to its wall-clock limit if that CDN stalls.
    // On timeout the AbortError falls through to the catch below → null (fail-fast).
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!imgRes.ok) return null;

    return imgRes.arrayBuffer();
  } catch (err) {
    console.warn('[image_generation] DALL-E 3 call failed:', err);
    return null;
  }
}
