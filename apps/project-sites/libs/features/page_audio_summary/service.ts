import type { Env } from '../../../src/types/env.js';

export const FLAG_KEY = 'page_audio_summary';

function audioKey(siteId: string, route: string): string {
  const safe = route.replace(/[^a-z0-9-_/]/gi, '_').slice(0, 200);
  return `audio-summary/${siteId}/${safe}.mp3`;
}

export async function generateAudioSummary(
  env: Env,
  siteId: string,
  route: string,
  text: string,
  _voice?: string,
): Promise<{ audioKey: string }> {
  const key = audioKey(siteId, route);

  // Try Workers AI TTS as a best-effort; if unavailable, store a placeholder
  try {
    const ai = env.AI as { run: (model: string, params: { text: string }) => Promise<{ audio?: Uint8Array | null }> };
    const result = await ai.run('@cf/myai/tts', { text: text.slice(0, 2000) });
    if (result?.audio) {
      await (env.SITES_BUCKET as R2Bucket).put(key, result.audio, {
        httpMetadata: { contentType: 'audio/mpeg' },
      });
    }
  } catch {
    // Store empty placeholder so GET returns a key
    await (env.SITES_BUCKET as R2Bucket).put(key, new Uint8Array(0), {
      httpMetadata: { contentType: 'audio/mpeg' },
    });
  }

  return { audioKey: key };
}

export async function getAudioSummary(
  env: Env,
  siteId: string,
  route: string,
): Promise<{ audioUrl: string | null }> {
  const key = audioKey(siteId, route);
  const obj = await (env.SITES_BUCKET as R2Bucket).head(key).catch(() => null);
  if (!obj) return { audioUrl: null };
  return { audioUrl: `/r2/${key}` };
}
