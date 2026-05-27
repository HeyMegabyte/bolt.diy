/**
 * Cloudflare Browser Rendering REST API wrapper. Used by the competitor-gap
 * detector to crawl peer URLs without spinning a Browser binding (cheaper,
 * no extra wrangler config). REST endpoints documented at:
 *   https://developers.cloudflare.com/browser-rendering/rest-api/
 */

import type { Env } from '../env.js';
import { AppError, ErrorCode } from '../types.js';

interface CfResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
}

/** Fetch the visible HTML/text content of a page. */
export async function renderContent(env: Env, url: string): Promise<string> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/content`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url, waitForTimeout: 8_000 }),
  });
  if (!res.ok) {
    throw new AppError(
      ErrorCode.AI_GENERATION_ERROR,
      `Browser Rendering /content failed for ${url}: ${res.status}`,
    );
  }
  // /content returns either { result: "<html>" } or raw HTML — handle both.
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const json = (await res.json()) as CfResponse<string>;
    if (!json.success) {
      throw new AppError(
        ErrorCode.AI_GENERATION_ERROR,
        `Browser Rendering errored: ${JSON.stringify(json.errors)}`,
      );
    }
    return json.result ?? '';
  }
  return res.text();
}

/**
 * Strip HTML to a compact text representation suitable for LLM prompts.
 * Drops <script>, <style>, comments; collapses whitespace; caps at 8 KB.
 */
export function htmlToPromptText(html: string, maxBytes = 8 * 1024): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length <= maxBytes) return stripped;
  return stripped.slice(0, maxBytes);
}
