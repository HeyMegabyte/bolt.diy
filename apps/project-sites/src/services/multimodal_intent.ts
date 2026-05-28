/**
 * @module multimodal_intent
 * @description AI intent extractor for the Multimodal Site Copilot.
 *
 * Accepts a multipart payload with any combination of:
 *   - `text`  — raw visitor text
 *   - `audio` — binary audio blob → Whisper STT → transcript
 *   - `image` — binary image blob → GPT-4o vision → description
 *
 * All three signals are fused into a single intent classification via Workers
 * AI Llama 3.3 70B FP8. Extracted structured fields (name, email, phone, date,
 * service, message) are returned alongside the classified intent and a
 * `suggested_route` to redirect the visitor to.
 *
 * @example
 * ```ts
 * const result = await processMultimodalIntent(env, {
 *   text: 'I need a quote for a roof repair',
 *   audio: audioBuffer,
 *   image: imageBuffer,
 *   siteSlug: 'example-roofing',
 * });
 * // → { intent: 'quote', extracted_fields: { service: 'roof repair' }, suggested_route: '/contact' }
 * ```
 */

import type { Env } from '../types/env.js';

export type CopilotIntent = 'book' | 'quote' | 'support' | 'browse' | 'unknown';

export interface MultimodalInput {
  text?: string | null;
  audio?: ArrayBuffer | null;
  image?: ArrayBuffer | null;
  siteSlug: string;
  orgId: string;
  siteId: string;
  visitorId?: string | null;
  anonId?: string | null;
}

export interface CopilotResult {
  intent: CopilotIntent;
  extracted_fields: {
    name?: string;
    email?: string;
    phone?: string;
    date?: string;
    service?: string;
    message?: string;
    [key: string]: string | undefined;
  };
  suggested_route: string;
  transcript?: string;       // from Whisper, if audio provided
  image_description?: string; // from GPT-4o vision, if image provided
  latency: { whisper_ms: number; vision_ms: number; classify_ms: number; total_ms: number };
}

// ── Whisper STT ───────────────────────────────────────────────────────────────

async function transcribeAudio(env: Env, audio: ArrayBuffer): Promise<{ text: string; ms: number }> {
  const t0 = Date.now();
  try {
    const response = await (env.AI.run as (model: string, opts: Record<string, unknown>) => Promise<{ text?: string }>)(
      '@cf/openai/whisper-tiny-en',
      { audio: [...new Uint8Array(audio)] },
    );
    return { text: response?.text?.trim() ?? '', ms: Date.now() - t0 };
  } catch {
    return { text: '', ms: Date.now() - t0 };
  }
}

// ── GPT-4o Vision ─────────────────────────────────────────────────────────────
// Uses OpenAI directly when OPENAI_API_KEY is set; gracefully degrades otherwise.

async function describeImage(env: Env, image: ArrayBuffer): Promise<{ description: string; ms: number }> {
  const t0 = Date.now();
  if (!env.OPENAI_API_KEY) return { description: '', ms: 0 };

  const base64 = btoa(String.fromCharCode(...new Uint8Array(image)));
  const ext = detectMimeType(image);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Describe what you see in this image in 1-3 sentences. Focus on any visible service needs, problems, or requests a customer might have.',
              },
              { type: 'image_url', image_url: { url: `data:${ext};base64,${base64}`, detail: 'low' } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return { description: '', ms: Date.now() - t0 };
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const description = data?.choices?.[0]?.message?.content?.trim() ?? '';
    return { description, ms: Date.now() - t0 };
  } catch {
    return { description: '', ms: Date.now() - t0 };
  }
}

function detectMimeType(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer.slice(0, 4));
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
}

// ── Intent Classification ─────────────────────────────────────────────────────

async function classifyIntent(
  env: Env,
  combined: string,
): Promise<{ result: Pick<CopilotResult, 'intent' | 'extracted_fields' | 'suggested_route'>; ms: number }> {
  const t0 = Date.now();
  const prompt = `You are an AI that classifies visitor intent for a small business website.

Given the visitor's combined input (text + voice transcript + image description), output ONLY valid JSON matching this schema:
{
  "intent": "book" | "quote" | "support" | "browse" | "unknown",
  "extracted_fields": { "name?": string, "email?": string, "phone?": string, "date?": string, "service?": string, "message?": string },
  "suggested_route": "/contact" | "/book" | "/quote" | "/services" | "/"
}

Intent definitions:
- book: wants to schedule/book an appointment
- quote: wants a price estimate or quote
- support: has a problem or complaint
- browse: exploring, no specific intent
- unknown: unclear

Visitor input:
${combined}

JSON:`;

  try {
    const response = await (env.AI.run as (model: string, opts: Record<string, unknown>) => Promise<{ response?: string }>)(
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      { prompt, max_tokens: 300 },
    );
    const raw = (response?.response ?? '').trim();
    // Extract JSON from response (LLM sometimes wraps in markdown)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        intent?: string;
        extracted_fields?: Record<string, string>;
        suggested_route?: string;
      };
      const validIntents: CopilotIntent[] = ['book', 'quote', 'support', 'browse', 'unknown'];
      const intent = validIntents.includes(parsed.intent as CopilotIntent)
        ? (parsed.intent as CopilotIntent)
        : 'unknown';
      return {
        result: {
          intent,
          extracted_fields: parsed.extracted_fields ?? {},
          suggested_route: parsed.suggested_route ?? '/contact',
        },
        ms: Date.now() - t0,
      };
    }
  } catch {
    // fall through to default
  }

  return {
    result: { intent: 'unknown', extracted_fields: {}, suggested_route: '/contact' },
    ms: Date.now() - t0,
  };
}

// ── Main Entry ────────────────────────────────────────────────────────────────

/**
 * Processes a multimodal visitor input and returns classified intent + extracted fields.
 *
 * @throws never — all errors are caught and reflected as `intent: 'unknown'`
 */
export async function processMultimodalIntent(
  env: Env,
  input: MultimodalInput,
): Promise<CopilotResult> {
  const totalStart = Date.now();

  let transcript = '';
  let imageDescription = '';
  let whisperMs = 0;
  let visionMs = 0;

  // Run audio + vision in parallel if both provided
  const [audioResult, visionResult] = await Promise.all([
    input.audio ? transcribeAudio(env, input.audio) : Promise.resolve({ text: '', ms: 0 }),
    input.image ? describeImage(env, input.image) : Promise.resolve({ description: '', ms: 0 }),
  ]);

  transcript = audioResult.text;
  whisperMs = audioResult.ms;
  imageDescription = visionResult.description;
  visionMs = visionResult.ms;

  // Combine all signals
  const parts: string[] = [];
  if (input.text) parts.push(`Text: ${input.text}`);
  if (transcript) parts.push(`Voice transcript: ${transcript}`);
  if (imageDescription) parts.push(`Image description: ${imageDescription}`);

  const combined = parts.join('\n') || 'No input provided';

  const { result, ms: classifyMs } = await classifyIntent(env, combined);
  const totalMs = Date.now() - totalStart;

  return {
    ...result,
    transcript: transcript || undefined,
    image_description: imageDescription || undefined,
    latency: { whisper_ms: whisperMs, vision_ms: visionMs, classify_ms: classifyMs, total_ms: totalMs },
  };
}

/**
 * Persists a copilot session to D1 after processing.
 */
export async function saveCopilotSession(
  env: Env,
  params: {
    orgId: string;
    siteId: string;
    siteSlug: string;
    input: MultimodalInput;
    result: CopilotResult;
  },
): Promise<string> {
  const { orgId, siteId, siteSlug, input, result } = params;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO copilot_sessions
       (id, org_id, site_id, site_slug, has_text, has_audio, has_image,
        transcript, image_description, intent, extracted_fields,
        suggested_route, whisper_ms, vision_ms, classify_ms, total_ms,
        visitor_id, anon_id, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id, orgId, siteId, siteSlug,
      input.text ? 1 : 0, input.audio ? 1 : 0, input.image ? 1 : 0,
      result.transcript ?? null,
      result.image_description ?? null,
      result.intent,
      JSON.stringify(result.extracted_fields),
      result.suggested_route,
      result.latency.whisper_ms, result.latency.vision_ms,
      result.latency.classify_ms, result.latency.total_ms,
      input.visitorId ?? null, input.anonId ?? null,
      'done', now, now,
    )
    .run()
    .catch(() => null);

  return id;
}
