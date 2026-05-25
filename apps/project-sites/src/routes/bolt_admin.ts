/**
 * Bolt admin endpoints — chat-state mirror, voice transcribe, vision OCR, prompt suggestions.
 *
 * @remarks
 *   Mounted under the same root as other admin routes; the bolt.diy frontend
 *   talks to these via fetch with bearer auth from the admin host.
 *   All routes are namespaced under `/admin-api/...` to keep them off the
 *   public site-serving paths.
 *
 *   NOTE (2026-05-24): Whisper is no longer wired from the editor surface.
 *   The /admin-api/transcribe route remains live so the browser
 *   SpeechRecognition path or future support tooling can still hit it,
 *   but no in-editor UI calls it anymore.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';

const bolt = new Hono<{ Bindings: Env; Variables: Variables }>();

const MODEL_TEXT = '@cf/meta/llama-3.1-8b-instruct-fp8' as const;
const MODEL_VISION = '@cf/meta/llama-3.2-11b-vision-instruct' as const;
const MODEL_WHISPER = '@cf/openai/whisper' as const;

/**
 * POST /admin-api/sites/by-slug/:slug/chat-state
 * Mirrors IDB chat-state to D1 once every 30s from the bolt.diy client.
 */
bolt.post('/admin-api/sites/by-slug/:slug/chat-state', async (c) => {
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
});

/**
 * POST /admin-api/transcribe
 * multipart/form-data audio → Whisper text.
 */
bolt.post('/admin-api/transcribe', async (c) => {
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
});

/**
 * POST /admin-api/vision-ocr
 * { image_data_url } → { caption, ocrText }
 */
bolt.post('/admin-api/vision-ocr', async (c) => {
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
});

/**
 * POST /admin-api/chat/suggest-prompts
 * { tail: [{role, content}], max } → { suggestions: [{label, prompt}] }
 * Caches by tail hash in KV (60s TTL) to avoid repeated Llama calls.
 */
bolt.post('/admin-api/chat/suggest-prompts', async (c) => {
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
});

export { bolt };
