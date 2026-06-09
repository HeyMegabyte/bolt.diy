/**
 * page_audio — auto-generate a short narrated audio version of a page.
 *
 * `POST /api/sites/:id/page-audio { text, title?, voice? }` chunks the page text
 * to TTS-safe lengths, renders each via the existing media TTS pipeline
 * (`generatePodcast`, single voice), stores the MP3 in R2, and returns the asset
 * URL. Flag-gated by `page_audio` (404 when off); Zod-validated; graceful note
 * when TTS isn't configured.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { generatePodcast } from '../services/media.js';

const Body = z.object({
  text: z.string().trim().min(1).max(50_000),
  title: z.string().trim().max(120).optional(),
  voice: z.string().trim().max(40).optional(),
});

/**
 * Split narration text into TTS-safe chunks (≤max chars) on sentence boundaries.
 * A single sentence longer than max is hard-split. Pure + deterministic
 * (exported for unit tests). Most TTS providers cap input near 4k chars.
 */
export function chunkForTts(text: string, max = 4000): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [clean];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > max) {
      if (cur.trim()) { chunks.push(cur.trim()); cur = ''; }
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max).trim());
      continue;
    }
    if ((cur + s).length > max) {
      if (cur.trim()) chunks.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export const pageAudio = new Hono<{ Bindings: Env; Variables: Variables }>();

pageAudio.post('/api/sites/:id/page-audio', async (c) => {
  const siteId = c.req.param('id');
  const on = await isFlagOn(c.env, 'page_audio', { siteId, orgId: c.get('orgId'), userId: c.get('userId') });
  if (!on) return c.notFound();

  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to generate page audio.' } }, 401);

  const parsed = Body.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Provide page text (1-50000 characters).' } }, 400);
  }

  const chunks = chunkForTts(parsed.data.text);
  if (!chunks.length) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'No readable text found.' } }, 400);

  const voice = parsed.data.voice ?? 'alloy';
  try {
    const asset = await generatePodcast(c.env, {
      orgId,
      createdBy: c.get('userId') ?? null,
      title: parsed.data.title ?? 'Page narration',
      script: chunks.map((text) => ({ voice, text })),
      voiceProvider: 'openai',
    });
    return c.json({ assetId: asset.id, audioUrl: `/api/media/assets/${asset.id}/raw`, segments: chunks.length });
  } catch (e) {
    const msg = (e as Error).message;
    const notes =
      msg === 'MEDIA_NO_TTS_CONFIGURED'
        ? 'Text-to-speech isn’t configured for this account yet.'
        : 'Couldn’t generate the audio right now — please try again.';
    return c.json({ assetId: null, audioUrl: null, notes }, 200);
  }
});
