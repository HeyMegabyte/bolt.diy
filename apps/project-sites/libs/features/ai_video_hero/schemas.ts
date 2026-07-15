/**
 * @module libs/features/ai_video_hero/schemas
 *
 * Zod schemas for AI Video Hero (#11, ROI 3.60) — cinematic brand video
 * generation from site research data. Generates a 60-second multi-clip script
 * with voiceover narration, then queues Sora/Veo + Piper TTS for production.
 */
import { z } from 'zod';

export const VideoClipSchema = z.object({
  /** Clip number 1-8. */
  index: z.number().int().min(1).max(8),
  /** Duration in seconds. */
  durationSec: z.number().min(3).max(15),
  /** Visual prompt for Sora/Veo generation. */
  visualPrompt: z.string(),
  /** Narration text for this clip (Piper TTS). */
  narration: z.string(),
  /** Suggested transition to next clip. */
  transition: z.enum(['fade', 'dissolve', 'cut', 'wipe']).default('dissolve'),
  /** Queue status. */
  status: z.enum(['queued', 'generating', 'complete', 'failed']).default('queued'),
});

export type VideoClip = z.infer<typeof VideoClipSchema>;

export const VideoScriptSchema = z.object({
  siteId: z.string(),
  generatedAt: z.string(),
  totalDurationSec: z.number().min(30).max(90),
  title: z.string(),
  voiceStyle: z.enum(['professional', 'warm', 'energetic', 'calm', 'dramatic']),
  backgroundMusic: z.enum(['cinematic', 'corporate', 'inspirational', 'ambient', 'none']).default('cinematic'),
  clips: z.array(VideoClipSchema).min(4).max(8),
  /** Estimated credit cost. */
  estimatedCost: z.string(),
});

export type VideoScript = z.infer<typeof VideoScriptSchema>;

export const VideoHeroRequestSchema = z.object({
  siteId: z.string().min(1),
  /** Business name for personalization. */
  businessName: z.string().min(1),
  /** Business description or tagline. */
  description: z.string().min(1),
  /** Key selling points (3-5 short phrases). */
  sellingPoints: z.array(z.string()).min(1).max(5),
  /** Brand voice/style preference. */
  style: VideoScriptSchema.shape.voiceStyle.optional().default('professional'),
  /** Key colors for visual prompts. */
  colors: z.array(z.string()).optional().default([]),
  /** Existing assets to reuse in prompts. */
  assetKeywords: z.array(z.string()).optional().default([]),
});
