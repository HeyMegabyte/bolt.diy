/**
 * AI Video Hero — feature module manifest.
 *
 * @remarks
 * Generates a 60-second cinematic brand video script from site research data.
 * Produces 8 clips with Sora/Veo-ready visual prompts, Piper TTS-ready
 * narration, transitions, and cost estimation. The actual video generation
 * is async (queued via media.ts stubs) — this module produces the script
 * that drives production.
 */
export const manifest = {
  slug: 'ai_video_hero',
  name: 'AI Video Hero',
  description:
    'AI-generated 60-second cinematic brand video script with 8 clips, visual prompts for Sora/Veo, Piper TTS narration, transitions, and credit cost estimation.',
  flagKey: 'ai_video_hero',
  owner: 'brian@megabyte.space',
  stage: 'experimental' as const,
  createdAt: '2026-07-15',
};
