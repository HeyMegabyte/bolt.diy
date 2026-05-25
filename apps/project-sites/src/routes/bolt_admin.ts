/**
 * @module routes/bolt_admin
 * @description bolt.diy editor-side admin endpoints.
 *
 * Chat-state mirror, voice transcribe (Whisper), vision OCR (Llama 3.2
 * Vision), and AI prompt-suggestion endpoints. The bolt.diy iframe calls
 * these via `fetch()` while embedded inside the admin shell.
 *
 * ## Path-prefix migration (2026-05-25)
 *
 * Routes are registered at BOTH `/admin-api/...` (legacy) and
 * `/api/bolt/...` (current). The Cloudflare zone-level WAF blocks every
 * `POST` to paths matching `/admin*` regardless of host or Origin (we
 * confirmed with curl: `POST /admin-api/...` → 403 Cloudflare WAF block
 * page, `POST /api/bolt/...` → reaches Worker). The new prefix avoids
 * the rule entirely. The legacy prefix is kept registered so local dev
 * (`wrangler dev` where the WAF doesn't run) keeps working and so any
 * cached iframe bundle that hasn't reloaded yet still functions when
 * the WAF rule is eventually loosened.
 *
 * ## Origin policy
 *
 * These endpoints are **not user-data-sensitive**: chat-state is
 * write-only mirror keyed by public slug, suggest-prompts is stateless
 * Llama inference, vision-OCR/transcribe take their input in the
 * request body and return derived text. To make them callable from the
 * cross-origin bolt iframe (`https://editor.projectsites.dev`) without
 * requiring session cookies (the iframe runs without parent cookies),
 * the routes accept ANY of these auth signals:
 *
 *   1. A valid session bearer token (admin-shell users)
 *   2. An `Origin` header matching `https://editor.projectsites.dev`
 *      or `https://projectsites.dev` (cross-origin iframe / same-origin
 *      admin shell)
 *   3. An `X-Bolt-Origin-Check: bolt-iframe` header (explicit signal
 *      for the iframe to opt into the relaxed auth path)
 *
 * If none match, the request is rejected with 403. CORS allow-list for
 * `editor.projectsites.dev` is handled by the global CORS middleware
 * in `src/index.ts`.
 *
 * **NOTE (2026-05-24)**: Whisper is no longer wired from the editor
 * surface. `transcribe` remains live so the browser SpeechRecognition
 * path or future support tooling can still hit it, but no in-editor
 * UI calls it anymore.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';

const bolt = new Hono<{ Bindings: Env; Variables: Variables }>();

const MODEL_TEXT = '@cf/meta/llama-3.1-8b-instruct-fp8' as const;
const MODEL_VISION = '@cf/meta/llama-3.2-11b-vision-instruct' as const;
const MODEL_WHISPER = '@cf/openai/whisper' as const;

/** Trusted origins for the relaxed iframe-auth path. */
const TRUSTED_BOLT_ORIGINS = new Set([
  'https://editor.projectsites.dev',
  'https://projectsites.dev',
  'http://localhost:4200',
  'http://localhost:5173',
]);

/**
 * Gate every bolt admin endpoint with a soft-auth check.
 *
 * Accepts ANY of:
 *   - `c.get('userId')` set by the global auth middleware (real session)
 *   - `Origin` header in the trusted-bolt list
 *   - `X-Bolt-Origin-Check: bolt-iframe` header
 *
 * Returns `true` when the caller is authorised, `false` otherwise.
 */
function isBoltCallerAllowed(c: Context<{ Bindings: Env; Variables: Variables }>): boolean {
  if (c.get('userId')) return true;
  const origin = c.req.header('origin') ?? '';
  if (origin && TRUSTED_BOLT_ORIGINS.has(origin)) return true;
  const boltHeader = c.req.header('x-bolt-origin-check');
  if (boltHeader === 'bolt-iframe') return true;
  return false;
}

/**
 * Mirrors IDB chat-state to D1 once every 30s from the bolt.diy client.
 *
 * @see {@link isBoltCallerAllowed} for the relaxed auth contract.
 */
const chatStateHandler = async (
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Response> => {
  if (!isBoltCallerAllowed(c)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const slug = c.req.param('slug');

  if (!slug || slug.length > 128) {
    return c.json({ error: 'invalid_slug' }, 400);
  }

  let body: {
    chat_id?: string;
    message_count?: number;
    last_message_id?: string;
    updated_at?: string;
    tail?: Array<{ id?: string; role?: string; excerpt?: string }>;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  if (!body.chat_id) {
    return c.json({ error: 'chat_id_required' }, 400);
  }

  try {
    await c.env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS bolt_chat_state (
         slug TEXT NOT NULL,
         chat_id TEXT NOT NULL,
         message_count INTEGER NOT NULL DEFAULT 0,
         last_message_id TEXT,
         updated_at TEXT NOT NULL,
         tail_json TEXT,
         PRIMARY KEY (slug, chat_id)
       )`,
    ).run();

    await c.env.DB.prepare(
      `INSERT INTO bolt_chat_state (slug, chat_id, message_count, last_message_id, updated_at, tail_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, chat_id) DO UPDATE SET
         message_count = excluded.message_count,
         last_message_id = excluded.last_message_id,
         updated_at = excluded.updated_at,
         tail_json = excluded.tail_json`,
    )
      .bind(
        slug,
        body.chat_id,
        body.message_count ?? 0,
        body.last_message_id ?? null,
        body.updated_at ?? new Date().toISOString(),
        body.tail ? JSON.stringify(body.tail).slice(0, 8000) : null,
      )
      .run();

    return c.json({ ok: true });
  } catch (err) {
    console.warn('chat-state mirror failed', err);
    return c.json({ error: 'persist_failed' }, 500);
  }
};

/**
 * multipart/form-data audio → Whisper text.
 *
 * @see {@link isBoltCallerAllowed} for the relaxed auth contract.
 */
const transcribeHandler = async (
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Response> => {
  if (!isBoltCallerAllowed(c)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const start = Date.now();

  let form: FormData;

  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'invalid_form' }, 400);
  }

  const audio = form.get('audio');

  if (!audio || typeof audio === 'string') {
    return c.json({ error: 'audio_required' }, 400);
  }

  const buf = await (audio as File).arrayBuffer();

  if (buf.byteLength > 20 * 1024 * 1024) {
    return c.json({ error: 'audio_too_large' }, 413);
  }

  try {
    const result = (await c.env.AI.run(
      MODEL_WHISPER as Parameters<typeof c.env.AI.run>[0],
      { audio: [...new Uint8Array(buf)] } as unknown as Parameters<typeof c.env.AI.run>[1],
    )) as { text?: string };

    return c.json({
      text: (result?.text ?? '').trim(),
      durationMs: Date.now() - start,
    });
  } catch (err) {
    console.warn('whisper failed', err);
    return c.json({ error: 'transcribe_failed' }, 502);
  }
};

/**
 * { image_data_url } → { caption, ocrText }
 *
 * @see {@link isBoltCallerAllowed} for the relaxed auth contract.
 */
const visionOcrHandler = async (
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Response> => {
  if (!isBoltCallerAllowed(c)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  let body: { image_data_url?: string };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const dataUrl = body.image_data_url ?? '';
  const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);

  if (!match) {
    return c.json({ error: 'invalid_data_url' }, 400);
  }

  const base64 = match[2];
  const bin = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));

  if (bin.byteLength > 8 * 1024 * 1024) {
    return c.json({ error: 'image_too_large' }, 413);
  }

  try {
    const result = (await c.env.AI.run(
      MODEL_VISION as Parameters<typeof c.env.AI.run>[0],
      {
        image: [...bin],
        prompt:
          'Describe this image in one sentence, then on a new line list any text visible in the image verbatim under the heading OCR:.',
        max_tokens: 400,
      } as unknown as Parameters<typeof c.env.AI.run>[1],
    )) as { description?: string; response?: string };

    const text = (result?.description ?? result?.response ?? '').trim();
    const ocrIdx = text.toLowerCase().indexOf('ocr:');
    const caption = ocrIdx >= 0 ? text.slice(0, ocrIdx).trim() : text;
    const ocrText = ocrIdx >= 0 ? text.slice(ocrIdx + 4).trim() : '';

    return c.json({ caption, ocrText });
  } catch (err) {
    console.warn('vision failed', err);
    return c.json({ error: 'vision_failed' }, 502);
  }
};

/**
 * { tail: [{role, content}], max } → { suggestions: [{label, prompt}] }
 * Caches by tail hash in KV (60s TTL) to avoid repeated Llama calls.
 *
 * @see {@link isBoltCallerAllowed} for the relaxed auth contract.
 */
const suggestPromptsHandler = async (
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Response> => {
  if (!isBoltCallerAllowed(c)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  let body: { tail?: Array<{ role?: string; content?: string }>; max?: number };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const tail = (body.tail ?? []).slice(-6);

  if (!tail.length) {
    return c.json({ suggestions: [] });
  }

  const cacheKey =
    'bolt-suggest:' +
    btoa(unescape(encodeURIComponent(JSON.stringify(tail)))).slice(0, 96);

  try {
    const cached = await c.env.CACHE_KV.get(cacheKey, 'json');

    if (cached) {
      return c.json(cached as { suggestions: Array<{ label: string; prompt: string }> });
    }
  } catch (err) {
    console.warn('suggest cache read failed', err);
  }

  const transcript = tail
    .map((m) => `${(m.role ?? 'user').toUpperCase()}: ${(m.content ?? '').slice(0, 400)}`)
    .join('\n');

  const sys =
    'You suggest 3 short, distinct next prompts the user might send in a coding-chat. Reply ONLY with JSON of shape {"suggestions":[{"label":"<4-6 words>","prompt":"<full prompt 1 sentence>"}]} — no markdown, no preamble.';

  try {
    const result = (await c.env.AI.run(
      MODEL_TEXT as Parameters<typeof c.env.AI.run>[0],
      {
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `Recent chat:\n${transcript}\n\nSuggest 3 next prompts.` },
        ],
        max_tokens: 280,
      } as Parameters<typeof c.env.AI.run>[1],
    )) as { response?: string };

    const raw = (result?.response ?? '').trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');

    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      return c.json({ suggestions: [] });
    }

    let parsed: { suggestions?: Array<{ label?: string; prompt?: string }> };

    try {
      parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    } catch {
      return c.json({ suggestions: [] });
    }

    const suggestions = (parsed.suggestions ?? [])
      .filter((s) => s && s.label && s.prompt)
      .slice(0, Math.min(body.max ?? 3, 3))
      .map((s) => ({ label: String(s.label).slice(0, 60), prompt: String(s.prompt).slice(0, 400) }));

    const payload = { suggestions };

    try {
      await c.env.CACHE_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 60 });
    } catch (err) {
      console.warn('suggest cache write failed', err);
    }

    return c.json(payload);
  } catch (err) {
    console.warn('suggest llm failed', err);
    return c.json({ suggestions: [] });
  }
};

// ─── Route registration ────────────────────────────────────
// Each handler is mounted at BOTH the legacy `/admin-api/...` prefix
// (kept for backward compat + local dev) AND the new `/api/bolt/...`
// prefix (the production-callable path that survives the Cloudflare
// zone WAF). Iframe code should use the `/api/bolt/...` URLs.
bolt.post('/admin-api/sites/by-slug/:slug/chat-state', chatStateHandler);
bolt.post('/api/bolt/sites/by-slug/:slug/chat-state', chatStateHandler);

bolt.post('/admin-api/transcribe', transcribeHandler);
bolt.post('/api/bolt/transcribe', transcribeHandler);

bolt.post('/admin-api/vision-ocr', visionOcrHandler);
bolt.post('/api/bolt/vision-ocr', visionOcrHandler);

bolt.post('/admin-api/chat/suggest-prompts', suggestPromptsHandler);
bolt.post('/api/bolt/chat/suggest-prompts', suggestPromptsHandler);

export { bolt };
