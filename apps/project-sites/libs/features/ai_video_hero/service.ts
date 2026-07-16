/**
 * @module libs/features/ai_video_hero/service
 *
 * Pure video script generator — produces a 60-second cinematic brand video
 * script with 7-8 clips, narration, and visual prompts. Zero I/O, deterministic.
 *
 * The generated script is ready for production:
 * - Visual prompts → Sora/Veo video generation (queued via media.ts stubs)
 * - Narration → Piper TTS (self-hosted, tts.projectsites.dev)
 * - Background music → royalty-free library
 * - Clip stitching → CF Browser Rendering + ffmpeg.wasm
 *
 * Clip structure (60 seconds):
 *   1. Hero opener (8s) — sweeping brand shot + business name
 *   2. Location (7s) — exterior/storefront
 *   3. Product/Service A (8s) — first key offering
 *   4. Product/Service B (7s) — second key offering
 *   5. People/Team (8s) — human connection
 *   6. Customer experience (8s) — testimonials/atmosphere
 *   7. CTAs + contact (7s) — phone/website/directions
 *   8. Logo closer (7s) — brand mark + tagline
 */
import type { VideoClip, VideoScript } from './schemas.js';

// ── Clip templates ──────────────────────────────────────────────────────────

interface ClipTemplate {
  label: string;
  durationSec: number;
  transition: VideoClip['transition'];
  visualFn: (ctx: ScriptContext) => string;
  narrationFn: (ctx: ScriptContext) => string;
}

interface ScriptContext {
  businessName: string;
  description: string;
  sellingPoints: string[];
  colors: string[];
  assetKeywords: string[];
}

const CLIP_TEMPLATES: ClipTemplate[] = [
  {
    label: 'Hero Opener',
    durationSec: 8,
    transition: 'dissolve',
    visualFn: (c) =>
      `Cinematic sweeping aerial shot of ${c.businessName} storefront, golden hour lighting, ${c.colors[0] || 'warm'} color palette, 4K, shallow depth of field`,
    narrationFn: (c) =>
      `Welcome to ${c.businessName}. ${c.description}`,
  },
  {
    label: 'Location',
    durationSec: 7,
    transition: 'cut',
    visualFn: (c) =>
      `Exterior establishing shot of ${c.businessName}, welcoming entrance, ${c.assetKeywords[0] || c.businessName} signage visible, natural lighting`,
    narrationFn: (c) =>
      `Located in the heart of the community, we have been serving our neighbors with pride.`,
  },
  {
    label: 'Service A',
    durationSec: 8,
    transition: 'dissolve',
    visualFn: (c) =>
      `Close-up macro product shot, ${c.colors[1] || c.colors[0] || 'professional'} lighting, slow motion detail, ${c.sellingPoints[0] || c.businessName} craftsmanship`,
    narrationFn: (c) =>
      c.sellingPoints[0]
        ? `${c.sellingPoints[0]}.`
        : `Quality and care in everything we do.`,
  },
  {
    label: 'Service B',
    durationSec: 7,
    transition: 'cut',
    visualFn: (c) =>
      `Dynamic action shot, ${c.assetKeywords[1] || c.sellingPoints[1] || 'service'} in motion, ${c.colors[0] || 'vibrant'} accents, motion blur`,
    narrationFn: (c) =>
      c.sellingPoints[1]
        ? `${c.sellingPoints[1]}.`
        : `Experience the difference that dedication makes.`,
  },
  {
    label: 'People',
    durationSec: 8,
    transition: 'dissolve',
    visualFn: (c) =>
      `Warm portrait-style shots of team members at work, genuine smiles, natural light, ${c.colors[1] || 'soft'} background bokeh`,
    narrationFn: () =>
      `Our team is passionate about what we do. Every day, we bring our best to serve you.`,
  },
  {
    label: 'Customer Experience',
    durationSec: 8,
    transition: 'fade',
    visualFn: (c) =>
      `Customer interaction shots, ${c.businessName} atmosphere, happy customers, ${c.colors[0] || 'warm'} ambient lighting, candid moments`,
    narrationFn: (c) =>
      c.sellingPoints[2]
        ? `${c.sellingPoints[2]}.`
        : `Our customers are at the heart of everything we do.`,
  },
  {
    label: 'Call to Action',
    durationSec: 7,
    transition: 'cut',
    visualFn: (c) =>
      `Clean graphic overlay on ${c.businessName} exterior, contact information appearing elegantly, ${c.colors[0] || 'brand'} color accents, modern typography`,
    narrationFn: (c) =>
      `Visit ${c.businessName} today. Call us or find us online. We can't wait to welcome you.`,
  },
  {
    label: 'Logo Closer',
    durationSec: 7,
    transition: 'fade',
    visualFn: (c) =>
      `Animated ${c.businessName} logo reveal, particle effects in ${c.colors[0] || 'gold'}, elegant fade to ${c.colors[1] || 'black'}, premium brand closer`,
    narrationFn: (c) =>
      `${c.businessName}. ${c.description}`,
  },
];

// ── Music selection ─────────────────────────────────────────────────────────

function selectMusic(style: VideoScript['voiceStyle']): VideoScript['backgroundMusic'] {
  switch (style) {
    case 'energetic': return 'inspirational';
    case 'dramatic': return 'cinematic';
    case 'warm': return 'ambient';
    case 'calm': return 'ambient';
    case 'professional':
    default: return 'corporate';
  }
}

// ── Cost estimation ─────────────────────────────────────────────────────────

function estimateCost(clips: VideoClip[]): string {
  // Sora: ~$0.05/sec = ~$0.40/clip × 8 clips = ~$3.20
  // Piper TTS: free (self-hosted)
  // Background music: free (royalty-free)
  // Total: ~$3.20 in AI credits
  const totalSec = clips.reduce((s, c) => s + c.durationSec, 0);
  const soraCost = totalSec * 0.05;
  return `~$${soraCost.toFixed(2)} in AI credits (Sora video generation; Piper TTS + music are free)`;
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Generates a complete 60-second cinematic brand video script from site data.
 *
 * Produces 8 clips with visual prompts (Sora/Veo-ready), narration text
 * (Piper TTS-ready), transitions, and a total cost estimate.
 *
 * @param siteId - The site being featured.
 * @param businessName - Business name for personalization.
 * @param description - One-line business description.
 * @param sellingPoints - 3-5 key selling phrases.
 * @param opts - Style, colors, and asset keyword overrides.
 * @returns A complete VideoScript ready for production queueing.
 */
export function generateVideoScript(
  siteId: string,
  businessName: string,
  description: string,
  sellingPoints: string[],
  opts: {
    style?: VideoScript['voiceStyle'];
    colors?: string[];
    assetKeywords?: string[];
  } = {},
): VideoScript {
  const ctx: ScriptContext = {
    businessName,
    description,
    sellingPoints,
    colors: opts.colors ?? [],
    assetKeywords: opts.assetKeywords ?? [],
  };

  const voiceStyle = opts.style ?? 'professional';
  const backgroundMusic = selectMusic(voiceStyle);

  const clips: VideoClip[] = CLIP_TEMPLATES.map((t, i) => ({
    index: i + 1,
    durationSec: t.durationSec,
    visualPrompt: t.visualFn(ctx),
    narration: t.narrationFn(ctx),
    transition: t.transition,
    status: 'queued' as const,
  }));

  const totalDurationSec = clips.reduce((s, c) => s + c.durationSec, 0);

  return {
    siteId,
    generatedAt: new Date().toISOString(),
    totalDurationSec,
    title: `${businessName} — Brand Video`,
    voiceStyle,
    backgroundMusic,
    clips,
    estimatedCost: estimateCost(clips),
  };
}
