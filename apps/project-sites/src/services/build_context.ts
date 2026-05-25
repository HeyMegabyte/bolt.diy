/**
 * @module services/build_context
 * @description Assembles all research + assets into a build context JSON for bolt.diy.
 *
 * The build context is stored in R2 and referenced by URL when
 * bolt.diy is loaded in an iframe. bolt.diy fetches the context
 * and uses it to generate the website — avoiding large postMessage payloads.
 */

import type { Env } from '../types/env.js';

interface AssetInfo {
  key: string;
  name: string;
  type: string;
  url: string;
  confidence: number;
  source: string;
}

interface BuildContext {
  version: '1';
  business: {
    name: string;
    address?: string;
    phone?: string;
    website?: string;
    category?: string;
  };
  research: {
    profile?: unknown;
    brand?: unknown;
    sellingPoints?: unknown;
    social?: unknown;
    images?: unknown;
  };
  assets: AssetInfo[];
  instructions: string;
  createdAt: string;
}

/**
 * Build the JSON envelope that bolt.diy fetches when it boots inside the editor iframe.
 *
 * @remarks
 * Replaces a large `postMessage` with a stable R2 URL so the editor can
 * pull assets + research without round-tripping the parent worker.
 * Enriches each asset with the public `https://{slug}.projectsites.dev`
 * URL when the caller did not pre-resolve one.
 *
 * @example
 * ```ts
 * const ctx = generateBuildContext(business, research, assets, slug);
 * const url = await storeBuildContext(env, slug, ctx);
 * iframe.src = `${EDITOR_ORIGIN}/chat?context=${encodeURIComponent(url)}`;
 * ```
 *
 * @see {@link storeBuildContext}
 */
export function generateBuildContext(
  business: { name: string; address?: string; phone?: string; website?: string; category?: string },
  research: {
    profile?: unknown;
    brand?: unknown;
    sellingPoints?: unknown;
    social?: unknown;
    images?: unknown;
  },
  assets: AssetInfo[],
  slug: string,
): BuildContext {
  const assetBaseUrl = `https://${slug}.projectsites.dev/assets`;

  // Add full URLs to assets
  const enrichedAssets = assets.map((a) => ({
    ...a,
    url: a.url || `${assetBaseUrl}/${a.key.replace(`sites/${slug}/assets/`, '')}`,
  }));

  return {
    version: '1',
    business,
    research,
    assets: enrichedAssets,
    instructions: [
      `Build a complete, gorgeous, animated portfolio website for "${business.name}".`,
      'Use the provided brand colors, fonts, and design style from the research data.',
      'Reference the asset URLs directly in <img> tags — they are already hosted and accessible.',
      enrichedAssets.some((a) => a.name.includes('logo'))
        ? 'Use the provided logo in the header and favicon references.'
        : 'Generate a text-based logo using the brand fonts and colors.',
      'Include smooth scroll animations, hover micro-interactions, and responsive mobile-first layout.',
      'Create all pages: index.html, privacy.html, terms.html, plus any relevant section pages.',
      'Include favicon references in the <head> linking to the provided favicon assets.',
    ].join('\n'),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Persist a build context envelope to R2 under `sites/{slug}/assets/_build-context.json`.
 *
 * @remarks
 * Returns the public URL the editor iframe can fetch directly. The R2
 * `httpMetadata.contentType` is set so the browser parses JSON without
 * additional headers from the worker.
 *
 * @example
 * ```ts
 * const url = await storeBuildContext(env, 'vitos-salon', ctx);
 * ```
 *
 * @see {@link generateBuildContext}
 */
export async function storeBuildContext(
  env: Env,
  slug: string,
  context: BuildContext,
): Promise<string> {
  const key = `sites/${slug}/assets/_build-context.json`;
  await env.SITES_BUCKET.put(key, JSON.stringify(context, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });

  return `https://${slug}.projectsites.dev/assets/_build-context.json`;
}
