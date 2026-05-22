/**
 * @module services/ai_context_extract
 *
 * Text extraction for AI chat context files. Supports PDFs and images. For
 * images we ask OpenAI gpt-4o-mini Vision to transcribe / describe the
 * content. For PDFs we attempt a direct gpt-4o-mini Vision call with the
 * base64-encoded PDF (OpenAI Vision handles single-image inputs natively;
 * for true multi-page PDFs the Vision call extracts the first page only —
 * callers must enforce the 4-page cap upstream).
 *
 * The extraction is budget-capped per file: max 4 Vision calls per file
 * (one per page) to keep cost predictable.
 */
import type { Env } from '../types/env.js';

/** Hard cap on Vision calls per file, regardless of page count. */
export const MAX_VISION_CALLS_PER_FILE = 4;

/** Max bytes the extractor will accept (10 MB). */
export const MAX_CONTEXT_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Result of an extraction attempt. `text` may be empty if the API was not
 * configured or all calls failed; that is not a fatal error — the file is
 * still saved and the user can re-trigger extraction later.
 */
export interface ExtractResult {
  text: string;
  pages_processed: number;
  truncated: boolean;
}

/**
 * Convert binary data to a base64 data URL suitable for OpenAI Vision.
 *
 * @param bytes - Raw file bytes.
 * @param mime  - MIME type of the file.
 * @returns Data URL string.
 */
export function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * Call OpenAI Vision (gpt-4o-mini) with an image data URL and a transcribe
 * instruction. Returns the model's textual output.
 *
 * @param env       - Worker env (provides OPENAI_API_KEY).
 * @param dataUrl   - Data URL for the image / page render.
 * @param prompt    - Instruction text — what to extract.
 * @returns The extracted text, or empty string on failure.
 * @throws Never throws — failures resolve to '' so callers can persist the
 *   file even when extraction is unavailable.
 */
export async function visionExtract(env: Env, dataUrl: string, prompt: string): Promise<string> {
  if (!env.OPENAI_API_KEY) return '';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return '';
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return j.choices?.[0]?.message?.content?.trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * Extract text from a PDF. The current implementation does a single Vision
 * call with the PDF base64 as an image input (OpenAI Vision returns
 * best-effort text for the first page). Future work: pre-render N pages
 * with PDF.js and call Vision per page (capped by MAX_VISION_CALLS_PER_FILE).
 *
 * @param env  - Worker env.
 * @param buf  - Raw PDF bytes.
 * @returns Extraction result with combined page text.
 */
export async function extractPdf(env: Env, buf: ArrayBuffer): Promise<ExtractResult> {
  const bytes = new Uint8Array(buf);
  const dataUrl = toDataUrl(bytes, 'application/pdf');
  const text = await visionExtract(
    env,
    dataUrl,
    'Transcribe all readable text from this PDF page-by-page. Preserve section headings as Markdown ## headings. Output plain text only, no commentary.',
  );
  return { text, pages_processed: text ? 1 : 0, truncated: false };
}

/**
 * Extract / describe an image with Vision.
 *
 * @param env  - Worker env.
 * @param buf  - Raw image bytes.
 * @param mime - Image MIME type (e.g. image/png, image/jpeg).
 * @returns Extraction result. Single-page result.
 */
export async function extractImage(
  env: Env,
  buf: ArrayBuffer,
  mime: string,
): Promise<ExtractResult> {
  const bytes = new Uint8Array(buf);
  const dataUrl = toDataUrl(bytes, mime || 'image/png');
  const text = await visionExtract(
    env,
    dataUrl,
    'Transcribe any readable text in this image. Then in a brief separate paragraph describe non-text visual content (charts, photos, diagrams) that an AI chat assistant might need to reference. Output plain text.',
  );
  return { text, pages_processed: text ? 1 : 0, truncated: false };
}

/**
 * Dispatch extraction based on MIME type. Falls back to a UTF-8 text read for
 * `text/*` types and an empty result for unrecognized binary types.
 *
 * @param env  - Worker env.
 * @param buf  - Raw bytes.
 * @param mime - MIME type as reported by the upload.
 * @returns Extraction result.
 */
export async function extractContext(
  env: Env,
  buf: ArrayBuffer,
  mime: string,
): Promise<ExtractResult> {
  const m = (mime || '').toLowerCase();
  if (m === 'application/pdf' || m.endsWith('/pdf')) return extractPdf(env, buf);
  if (m.startsWith('image/')) return extractImage(env, buf, m);
  if (m.startsWith('text/') || m === 'application/json') {
    return {
      text: new TextDecoder().decode(buf).slice(0, 200_000),
      pages_processed: 1,
      truncated: buf.byteLength > 200_000,
    };
  }
  return { text: '', pages_processed: 0, truncated: false };
}
