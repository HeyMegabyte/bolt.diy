/**
 * AI surface. Every call is rate-limited per user and routed through the AI
 * Gateway cache. Fallback chain inherited from `aiCall` in `services/ai-gateway.ts`.
 *
 * Endpoints (Wave 1B — BACKLOG_50 #8, #10, #13, #14, #18):
 *   POST /api/ai/complete          — raw provider passthrough (kept for power users)
 *   POST /api/ai/alt-text          — #8  vision-based alt text for an image URL
 *   POST /api/ai/podcast           — #10 60-90s spoken podcast from page markdown
 *   POST /api/ai/competitor-gap    — #13 crawl peers, diff sections, suggest copy
 *   (logs natural-language search lives at /api/sites/:siteId/logs/search — see sites.ts)
 *
 * Every route validates the body with `@hono/zod-validator`, writes an audit row,
 * and returns a Problem-Details envelope on failure via the shared error handler.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  MODELS,
  aiCall,
  aiTextCompletion,
  aiVisionCompletion,
  openAiTts,
} from '../services/ai-gateway.js';
import { renderContent, htmlToPromptText } from '../services/browser-rendering.js';
import { sha256Hex } from '../services/crypto.js';
import { dbInsert, dbQueryOne } from '../services/db.js';
import { writeAudit } from '../services/audit.js';

const app = new Hono<HonoEnv>();
app.use('*', rateLimit('ai'));

// ── #8 raw passthrough (existing) ────────────────────────────────────────────

app.post(
  '/complete',
  zValidator(
    'json',
    z.object({
      provider: z.enum(['anthropic', 'openai', 'workers-ai']),
      model: z.string().min(1),
      body: z.record(z.string(), z.unknown()),
      cache: z.boolean().default(true),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const body = c.req.valid('json');
    const result = await aiCall(c.env, {
      provider: body.provider,
      model: body.model,
      body: body.body,
      cache: body.cache,
    });
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: c.get('tenantId'),
      event: 'ai.complete',
      target_type: 'ai_call',
      target_id: null,
      metadata: { provider: result.provider, model: result.model, cached: result.cached },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json(result);
  },
);

// ── #8 AI alt-text generator ─────────────────────────────────────────────────

const ALT_PROMPT =
  'Describe this image in 8-15 words, factually, for an alt attribute. ' +
  'No flowery language. Output the description only, no preamble.';

app.post(
  '/alt-text',
  zValidator(
    'json',
    z.object({
      image_url: z.string().url(),
      image_id: z.string().min(1).optional(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const { image_url, image_id } = c.req.valid('json');

    const alt_text = sanitizeAlt(
      await aiVisionCompletion(c.env, {
        prompt: ALT_PROMPT,
        image_url,
        max_tokens: 64,
      }),
    );

    // Persist on the image asset row when caller supplies an id; otherwise upsert
    // by URL so the upload flow gets a single source of truth.
    const tenantId = c.get('tenantId') ?? c.get('orgId') ?? null;
    if (tenantId) {
      const existing = await dbQueryOne<{ id: string }>(
        c.env.DB,
        `SELECT id FROM image_assets WHERE tenant_id = ?1 AND url = ?2`,
        [tenantId, image_url],
      );
      const now = new Date().toISOString();
      if (existing) {
        await c.env.DB.prepare(
          `UPDATE image_assets
             SET alt_text = ?1, alt_text_model = ?2, alt_text_generated_at = ?3, updated_at = ?3
           WHERE id = ?4`,
        )
          .bind(alt_text, MODELS.LLAMA_4_SCOUT, now, existing.id)
          .run();
      } else {
        await dbInsert(c.env.DB, 'image_assets', {
          id: image_id ?? crypto.randomUUID(),
          tenant_id: tenantId,
          uploader_user_id: userId,
          url: image_url,
          alt_text,
          alt_text_model: MODELS.LLAMA_4_SCOUT,
          alt_text_generated_at: now,
        });
      }
    }

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'ai.alt_text',
      target_type: 'image',
      target_id: image_id ?? null,
      metadata: { image_url, length: alt_text.length },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({ alt_text, model: MODELS.LLAMA_4_SCOUT });
  },
);

// ── #10 AI podcast per page ──────────────────────────────────────────────────

const PODCAST_PROMPT =
  'Rewrite this as a 60-90 second spoken podcast intro, conversational, ' +
  'single host. No SSML, no stage directions, no headers. Output only the script.';

app.post(
  '/podcast',
  zValidator(
    'json',
    z.object({
      slug: z
        .string()
        .min(1)
        .max(120)
        .regex(/^[a-z0-9][a-z0-9/-]*$/i),
      body_markdown: z.string().min(50).max(50_000),
      site_id: z.string().min(1).optional(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const { slug, body_markdown, site_id } = c.req.valid('json');
    const tenantId = c.get('tenantId') ?? c.get('orgId');
    if (!tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'tenant required');

    const stripped = stripMarkdown(body_markdown);
    const content_hash = await sha256Hex(stripped);

    // Idempotency: hash hit → return existing.
    const existing = await dbQueryOne<{
      audio_url: string;
      duration_ms: number;
      audio_r2_key: string;
    }>(
      c.env.DB,
      `SELECT audio_url, duration_ms, audio_r2_key FROM page_podcasts
       WHERE tenant_id = ?1 AND slug = ?2 AND content_hash = ?3`,
      [tenantId, slug, content_hash],
    );
    if (existing) {
      return c.json({
        audio_url: existing.audio_url,
        duration_ms: existing.duration_ms,
        cached: true,
      });
    }

    // Step 1: script via Llama 3.3.
    const script = (
      await aiTextCompletion(c.env, {
        system: PODCAST_PROMPT,
        user: stripped.slice(0, 12_000),
        max_tokens: 400,
      })
    ).slice(0, 4_000);

    // Step 2: TTS via OpenAI through AI Gateway.
    const TTS_MODEL = 'gpt-4o-mini-tts';
    const mp3 = await openAiTts(c.env, { model: TTS_MODEL, voice: 'alloy', text: script });

    // Step 3: store in R2.
    const r2Key = `podcasts/${slug}.mp3`;
    await c.env.BUCKET.put(r2Key, mp3, {
      httpMetadata: { contentType: 'audio/mpeg', cacheControl: 'public, max-age=31536000' },
      customMetadata: { tenant_id: tenantId, slug, content_hash },
    });

    // Step 4: rough duration estimate (~24 kbps avg for mini-tts mp3).
    const duration_ms = Math.max(1_000, Math.round((mp3.byteLength * 8) / 24));

    const audio_url = `https://cdn.projectsites.dev/${r2Key}`;
    const id = crypto.randomUUID();
    await dbInsert(c.env.DB, 'page_podcasts', {
      id,
      tenant_id: tenantId,
      site_id: site_id ?? null,
      slug,
      content_hash,
      audio_r2_key: r2Key,
      audio_url,
      duration_ms,
      script,
      voice: 'alloy',
      tts_model: TTS_MODEL,
    });

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'ai.podcast',
      target_type: 'page_podcast',
      target_id: id,
      metadata: { slug, duration_ms, bytes: mp3.byteLength },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({ audio_url, duration_ms, cached: false });
  },
);

// ── #31 Whisper-generated video captions ─────────────────────────────────────

interface WhisperSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface TranscribeResponse {
  readonly segments: readonly WhisperSegment[];
  readonly language: string | null;
  readonly vtt_url: string;
  readonly vtt_r2_key: string;
  readonly cached: boolean;
}

app.post(
  '/transcribe',
  zValidator(
    'json',
    z.object({
      audio_url: z.string().url(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const { audio_url } = c.req.valid('json');
    const tenantId = c.get('tenantId') ?? c.get('orgId') ?? null;

    // Hash on the source URL — same R2 object hashes identically.
    const video_hash = await sha256Hex(audio_url);

    // Cache hit: KV first (cheapest), then D1 row.
    const kvKey = `cap:${video_hash}`;
    const cachedKv = await c.env.CACHE.get<TranscribeResponse>(kvKey, 'json');
    if (cachedKv) {
      return c.json({ ...cachedKv, cached: true });
    }
    const existing = await dbQueryOne<{
      segments_json: string;
      language: string | null;
      vtt_url: string;
      vtt_r2_key: string;
    }>(
      c.env.DB,
      `SELECT segments_json, language, vtt_url, vtt_r2_key FROM video_captions WHERE video_hash = ?1`,
      [video_hash],
    );
    if (existing) {
      const response: TranscribeResponse = {
        segments: JSON.parse(existing.segments_json) as readonly WhisperSegment[],
        language: existing.language,
        vtt_url: existing.vtt_url,
        vtt_r2_key: existing.vtt_r2_key,
        cached: true,
      };
      await c.env.CACHE.put(kvKey, JSON.stringify(response), { expirationTtl: 86_400 });
      return c.json(response);
    }

    // Stream audio bytes from source (R2 or external) and hand to Workers AI.
    const audioRes = await fetch(audio_url);
    if (!audioRes.ok) {
      throw new AppError(
        ErrorCode.AI_GENERATION_ERROR,
        `audio fetch failed (${audioRes.status}) for ${audio_url}`,
      );
    }
    const audioBytes = new Uint8Array(await audioRes.arrayBuffer());

    const runner = c.env.AI as unknown as {
      run: (model: string, body: Record<string, unknown>) => Promise<unknown>;
    };
    const whisperRaw = await runner.run(MODELS.WHISPER, {
      audio: Array.from(audioBytes),
    });

    const { segments, language } = parseWhisper(whisperRaw);
    const vtt = segmentsToVtt(segments);

    const vtt_r2_key = `captions/${video_hash}.vtt`;
    await c.env.BUCKET.put(vtt_r2_key, vtt, {
      httpMetadata: { contentType: 'text/vtt; charset=utf-8', cacheControl: 'public, max-age=31536000' },
      customMetadata: { video_hash, source_url: audio_url, language: language ?? '' },
    });
    const vtt_url = `https://cdn.projectsites.dev/${vtt_r2_key}`;

    await dbInsert(c.env.DB, 'video_captions', {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      video_hash,
      source_url: audio_url,
      vtt_r2_key,
      vtt_url,
      language,
      segments_json: JSON.stringify(segments),
      model: MODELS.WHISPER,
      bytes: vtt.length,
    });

    const response: TranscribeResponse = {
      segments,
      language,
      vtt_url,
      vtt_r2_key,
      cached: false,
    };
    await c.env.CACHE.put(kvKey, JSON.stringify(response), { expirationTtl: 86_400 });

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'ai.transcribe',
      target_type: 'video_caption',
      target_id: video_hash,
      metadata: { audio_url, segments: segments.length, language },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json(response);
  },
);

/** Workers AI Whisper returns heterogenous shapes — parse defensively. */
export function parseWhisper(raw: unknown): {
  segments: WhisperSegment[];
  language: string | null;
} {
  if (!raw || typeof raw !== 'object') return { segments: [], language: null };
  const obj = raw as Record<string, unknown>;
  const language =
    typeof obj['language'] === 'string'
      ? (obj['language'] as string)
      : null;

  // Preferred shape: { segments: [{ start, end, text }] }
  const rawSegments = obj['segments'];
  if (Array.isArray(rawSegments)) {
    const segments: WhisperSegment[] = [];
    for (const s of rawSegments) {
      if (!s || typeof s !== 'object') continue;
      const seg = s as Record<string, unknown>;
      const start = typeof seg['start'] === 'number' ? (seg['start'] as number) : null;
      const end = typeof seg['end'] === 'number' ? (seg['end'] as number) : null;
      const text = typeof seg['text'] === 'string' ? (seg['text'] as string) : null;
      if (start === null || end === null || text === null) continue;
      segments.push({ start, end, text: text.trim() });
    }
    if (segments.length > 0) return { segments, language };
  }

  // Fallback shape: { text: '...' } → single segment covering 0..duration.
  if (typeof obj['text'] === 'string') {
    return {
      segments: [{ start: 0, end: 5, text: (obj['text'] as string).trim() }],
      language,
    };
  }
  return { segments: [], language };
}

/** Convert Whisper segments to a WebVTT cue file. */
export function segmentsToVtt(segments: readonly WhisperSegment[]): string {
  const lines = ['WEBVTT', ''];
  for (const seg of segments) {
    lines.push(`${formatVttTime(seg.start)} --> ${formatVttTime(seg.end)}`);
    lines.push(seg.text);
    lines.push('');
  }
  return lines.join('\n');
}

/** Format seconds as HH:MM:SS.mmm per WebVTT spec. */
export function formatVttTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.floor((safe - Math.floor(safe)) * 1000);
  const pad = (n: number, w = 2): string => `${n}`.padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

// ── #13 Competitor-gap detector ──────────────────────────────────────────────

const GAP_PROMPT_SYSTEM =
  'You audit a tenant marketing site against competitor pages. Identify up to 5 ' +
  'sections the tenant is MISSING that competitors clearly have (e.g. pricing table, ' +
  'testimonials, FAQ, integrations grid, comparison page). For each gap, return one ' +
  'short factual section name and one paragraph of suggested copy (≤80 words, ' +
  'plain language, no slop words). Return ONLY a JSON object with shape ' +
  '{"missing_sections":[{"name":"...","suggested_copy":"..."}]} — no preamble.';

interface GapResult {
  missing_sections: ReadonlyArray<{ name: string; suggested_copy: string }>;
}

app.post(
  '/competitor-gap',
  zValidator(
    'json',
    z.object({
      org_id: z.string().min(1),
      competitor_urls: z.array(z.string().url()).min(1).max(5),
      tenant_site_summary: z.string().max(4_000).optional(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const { org_id, competitor_urls, tenant_site_summary } = c.req.valid('json');
    const tenantId = c.get('tenantId') ?? c.get('orgId');

    // Crawl each competitor in parallel via Browser Rendering REST.
    interface Snippet {
      url: string;
      text: string;
      error: string | null;
    }
    const urlList = (competitor_urls as ReadonlyArray<string>) ?? [];
    const snippets: Snippet[] = await Promise.all(
      urlList.map(async (url: string): Promise<Snippet> => {
        try {
          const html = await renderContent(c.env, url);
          return { url, text: htmlToPromptText(html, 3_000), error: null };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { url, text: '', error: msg };
        }
      }),
    );

    const summary: string =
      typeof tenant_site_summary === 'string' ? String(tenant_site_summary) : '';
    const userPrompt = [
      summary ? `Tenant site summary:\n${summary.slice(0, 2_000)}\n\n` : '',
      'Competitor pages:\n',
      ...snippets.map(
        (s: Snippet) =>
          `--- ${s.url} ---\n${s.error ? `[crawl error: ${s.error}]` : s.text}\n`,
      ),
    ].join('');

    const raw = await aiTextCompletion(c.env, {
      system: GAP_PROMPT_SYSTEM,
      user: userPrompt,
      max_tokens: 800,
    });
    const parsed = parseGapResult(raw);

    const id = crypto.randomUUID();
    await dbInsert(c.env.DB, 'competitor_gaps', {
      id,
      org_id,
      tenant_id: tenantId,
      competitor_urls: JSON.stringify(urlList),
      result_json: JSON.stringify(parsed),
      model: MODELS.LLAMA_3_3_70B,
    });

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'ai.competitor_gap',
      target_type: 'competitor_gap',
      target_id: id,
      metadata: { org_id, competitor_count: urlList.length },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({ id, ...parsed });
  },
);

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Tighten LLM alt-text output to a single line, drop quotes / preambles. Cap at
 * 200 chars so over-eager models don't blow the alt attribute.
 */
export function sanitizeAlt(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(alt text:|description:|image:)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Strip Markdown to plain text for TTS / LLM consumption. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1') // links → label
    .replace(/^#{1,6}\s+/gm, '') // headers
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1') // bold / italic
    .replace(/^>\s?/gm, '') // blockquotes
    .replace(/^[-*+]\s+/gm, '') // bullet markers
    .replace(/^\d+\.\s+/gm, '') // numbered lists
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-effort JSON extraction from an LLM-emitted blob. Falls back to an empty
 * gap list when the model produced prose instead of JSON.
 */
export function parseGapResult(raw: string): GapResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { missing_sections: [] };
  try {
    const obj = JSON.parse(match[0]) as { missing_sections?: unknown };
    const list = Array.isArray(obj.missing_sections) ? obj.missing_sections : [];
    const cleaned = list
      .filter(
        (x): x is { name: string; suggested_copy: string } =>
          typeof x === 'object' &&
          x !== null &&
          typeof (x as { name?: unknown }).name === 'string' &&
          typeof (x as { suggested_copy?: unknown }).suggested_copy === 'string',
      )
      .slice(0, 5)
      .map((x) => ({
        name: x.name.trim().slice(0, 80),
        suggested_copy: x.suggested_copy.trim().slice(0, 600),
      }));
    return { missing_sections: cleaned };
  } catch {
    return { missing_sections: [] };
  }
}

export default app;
