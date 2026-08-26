/**
 * @module services/image_art_direction
 * @description Supreme, ultra-realistic art-direction for every generated image.
 *
 * Brian requirement: every generated site must ship MANY DALL·E images that are
 * PERFECT for their context and rendered with an ultra-realistic, artistic sense
 * of taste — never a generic stock cue. This module is the single source of truth
 * for turning a thin per-slot subject cue into a rich, context-aware, photographic
 * prompt. Both image paths inherit it:
 *
 *  - the media library ({@link image_generation.callDallE3} → `POST /api/media/generate/image`)
 *  - the resumable `workflows/image-generation.ts` DALL·E + Stability steps
 *
 * The preamble bakes in real camera/lens language (photorealism, 35mm, natural
 * light, shallow depth of field), a slot-derived subject, the business vertical +
 * brand palette + mood, correct framing per slot, and a negative-prompt tail
 * (no cartoon, no distortion, no logos, no text artifacts). It is IDEMPOTENT —
 * a prompt already art-directed (sentinel present) is returned untouched so the
 * two call sites never double-wrap.
 *
 * @remarks Pure functions — same inputs → same output, no I/O, no side effects.
 * @packageDocumentation
 */

/**
 * The image slot a generated asset fills. Drives subject derivation + framing.
 * `hero`/`section`/`background` are landscape; `feature`/`gallery`/`team`/
 * `service`/`storefront` are flexible; `logo`/`icon`/`favicon` are square marks
 * (art-direction is skipped for marks — they have their own generation path).
 */
export type ImageSlot =
  | 'hero'
  | 'section'
  | 'background'
  | 'feature'
  | 'bento'
  | 'gallery'
  | 'team'
  | 'service'
  | 'storefront'
  | 'product'
  | 'about'
  | 'testimonial'
  | 'logo'
  | 'icon'
  | 'favicon';

/** Photographic mood applied to the lighting + grade of the shot. */
export type ImageMood = 'warm' | 'bright' | 'editorial' | 'moody' | 'clean' | 'cinematic';

/** Invisible sentinel appended to a directed prompt so enrichment is idempotent. */
export const ART_DIRECTION_SENTINEL = '[[ps-art-directed]]';

/** Slots that are brand MARKS, not photographs — never photo-art-directed. */
const MARK_SLOTS: ReadonlySet<ImageSlot> = new Set<ImageSlot>(['logo', 'icon', 'favicon']);

/** Landscape slots that must frame 1200-wide (16:9). Everything else is flexible. */
const LANDSCAPE_SLOTS: ReadonlySet<ImageSlot> = new Set<ImageSlot>([
  'hero',
  'section',
  'background',
]);

/**
 * Input for {@link buildArtDirectedPrompt}. Every field except `subject` is
 * optional — a bare subject cue still yields a fully art-directed prompt using
 * safe defaults.
 */
export interface ArtDirectionInput {
  /** The raw per-slot subject cue (from research_images or the caller). */
  subject: string;
  /** Which slot this image fills — drives framing + fallback subject. */
  slot?: ImageSlot;
  /** Business vertical (`dental`, `restaurant`, `law firm`, …) for context. */
  vertical?: string | null;
  /** Business name — woven in as environment context, never as on-image text. */
  businessName?: string | null;
  /** 1-4 brand hex/color words to steer the palette (`#0ea5e9`, `warm terracotta`). */
  brandPalette?: readonly string[] | null;
  /** Desired mood; defaults to a slot-appropriate mood when omitted. */
  mood?: ImageMood | null;
}

/**
 * The shared art-direction preamble every photographic image inherits.
 * Real camera/lens language forces photorealism and kills the "AI stock" look.
 */
const PHOTO_PREAMBLE =
  'Ultra-realistic editorial photograph, shot on a full-frame 35mm camera with a fast prime lens, ' +
  'natural directional light, shallow depth of field with gentle background bokeh, true-to-life color, ' +
  'fine detail and natural skin texture, photojournalistic candid framing, professional color grade, ' +
  'high dynamic range, sharp focus on the subject';

/**
 * The negative-prompt tail every photographic image inherits — bans the failure
 * modes that make AI imagery read as fake or unusable on a real business site.
 */
const NEGATIVE_TAIL =
  'Not an illustration, not a cartoon, not 3D render, not CGI, not a painting, no cinematic teal-orange over-grade, ' +
  'no text, no words, no letters, no captions, no watermark, no logo, no signage text, no UI, no borders or frames, ' +
  'no deformed hands, no extra fingers, no distorted faces, no warped anatomy, no plastic skin, no oversaturation, ' +
  'no lens flare artifacts, no duplicated limbs, no gibberish text';

/**
 * Per-slot subject template. Receives a normalized vertical noun and returns a
 * concrete, real-feeling scene for that slot — so an empty/thin cue still
 * produces a context-perfect image instead of a generic stock cliché.
 */
function slotSubjectFallback(slot: ImageSlot, vertical: string): string {
  switch (slot) {
    case 'hero':
    case 'background':
      return `the interior of a real, modern ${vertical}, welcoming and immaculately kept, people naturally present and at ease`;
    case 'section':
      return `an authentic detail moment inside a working ${vertical}, real people, real environment`;
    case 'team':
      return `the real team of a ${vertical} — approachable professionals in their actual workspace, natural candid expressions`;
    case 'testimonial':
      return `a genuine, happy customer of a ${vertical}, relaxed and smiling, real setting`;
    case 'service':
    case 'feature':
    case 'bento':
      return `a specific service being performed at a ${vertical}, hands-on and authentic, real tools and environment`;
    case 'storefront':
      return `the real storefront and entrance of a ${vertical}, inviting curb appeal, natural daylight`;
    case 'product':
      return `a hero product or offering of a ${vertical}, styled cleanly on a real surface, soft natural light`;
    case 'gallery':
      return `a striking real moment from a ${vertical}, gallery-worthy composition`;
    case 'about':
      return `an honest behind-the-scenes moment at a ${vertical} that conveys craft and care`;
    default:
      return `a real, professional environment of a ${vertical}`;
  }
}

/** Default mood by slot when the caller doesn't specify one. */
function slotDefaultMood(slot: ImageSlot): ImageMood {
  if (slot === 'hero' || slot === 'background') return 'bright';
  if (slot === 'team' || slot === 'testimonial' || slot === 'about') return 'warm';
  if (slot === 'product' || slot === 'service' || slot === 'feature' || slot === 'bento')
    return 'clean';
  return 'editorial';
}

/** Human lighting/grade phrase for a mood. */
function moodPhrase(mood: ImageMood): string {
  switch (mood) {
    case 'warm':
      return 'warm golden-hour light, inviting and human';
    case 'bright':
      return 'bright airy daylight, fresh and optimistic';
    case 'editorial':
      return 'clean editorial daylight, magazine-quality composition';
    case 'moody':
      return 'soft low-key light with rich shadows, refined and premium';
    case 'clean':
      return 'even soft studio-like light, crisp and uncluttered';
    case 'cinematic':
      return 'gentle cinematic light with natural falloff (never over-graded)';
  }
}

/**
 * Normalize a vertical string into a concrete noun for the templates. Falls back
 * to a generic-but-real "professional local business" when unknown, never a
 * hollow "business".
 */
function normalizeVertical(vertical?: string | null): string {
  const v = (vertical ?? '').trim().toLowerCase();
  if (!v) return 'professional local business';
  // Strip trailing filler words that read badly mid-sentence.
  return v.replace(/\b(business|company|services?|inc\.?|llc\.?)\b/g, '').trim() || v;
}

/**
 * Build a supreme, ultra-realistic, context-aware DALL·E prompt for one image
 * slot. Idempotent: an already-directed prompt (sentinel present) is returned
 * verbatim. Mark slots (`logo`/`icon`/`favicon`) are returned verbatim — they
 * are not photographs.
 *
 * @returns The enriched prompt (≤ ~1000 chars, well under the 4000 DALL·E cap).
 *
 * @example
 * ```ts
 * buildArtDirectedPrompt({
 *   subject: 'reception area',
 *   slot: 'hero',
 *   vertical: 'dental clinic',
 *   brandPalette: ['#0ea5e9', 'clean white'],
 * });
 * // → "Ultra-realistic editorial photograph, shot on a full-frame 35mm camera …
 * //    Subject: the interior of a real, modern dental clinic … reception area …
 * //    Palette accents of #0ea5e9, clean white … 16:9 landscape hero framing …
 * //    Not an illustration … no text … [[ps-art-directed]]"
 * ```
 */
export function buildArtDirectedPrompt(input: ArtDirectionInput): string {
  const rawSubject = (input.subject ?? '').trim();
  const slot: ImageSlot = input.slot ?? 'section';

  // Already directed → don't double-wrap (both call sites are safe to re-run).
  if (rawSubject.includes(ART_DIRECTION_SENTINEL)) return rawSubject;

  // Brand marks are not photographs — leave the caller's prompt untouched.
  if (MARK_SLOTS.has(slot)) return rawSubject;

  const vertical = normalizeVertical(input.vertical);
  const mood = input.mood ?? slotDefaultMood(slot);

  // Derive the subject: prefer the caller's cue, ground it in the vertical + slot;
  // when the cue is thin/empty, fall back to a concrete slot-specific scene.
  const fallback = slotSubjectFallback(slot, vertical);
  const subject = rawSubject.length >= 4 ? `${fallback}. Featuring: ${rawSubject}` : fallback;

  const businessContext = input.businessName
    ? `Context: this is for ${input.businessName.trim()} (a ${vertical}) — depict the real place, never render its name as text. `
    : `Context: a real, specific ${vertical}. `;

  const palette =
    input.brandPalette && input.brandPalette.length > 0
      ? `Subtle brand palette accents of ${input.brandPalette.slice(0, 4).join(', ')} in the environment (props, walls, wardrobe) — tasteful, never neon. `
      : '';

  const framing = LANDSCAPE_SLOTS.has(slot)
    ? 'Composition: wide 16:9 landscape framing, 1200px-wide banner-ready, generous negative space for overlaid headline text (leave the upper-left clear). '
    : slot === 'product'
      ? 'Composition: balanced product framing with clean surrounding space. '
      : 'Composition: natural balanced framing with room to breathe. ';

  return [
    PHOTO_PREAMBLE + '.',
    `Subject: ${subject}.`,
    businessContext,
    palette,
    `Mood: ${moodPhrase(mood)}.`,
    framing,
    NEGATIVE_TAIL + '.',
    ART_DIRECTION_SENTINEL,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convenience: enrich a possibly-thin prompt in place, inferring only the slot.
 * Used by transport chokepoints that have a prompt but no structured metadata —
 * they pass whatever they know (often just the raw prompt). Idempotent.
 *
 * @param prompt - The incoming (possibly already-directed) prompt.
 * @param slot - Best-known slot; defaults to `section`.
 * @param vertical - Best-known vertical, if any.
 * @returns The art-directed prompt.
 *
 * @example
 * ```ts
 * const p = ensureArtDirected('a bright dental office reception', 'hero', 'dental clinic');
 * ```
 */
export function ensureArtDirected(
  prompt: string,
  slot: ImageSlot = 'section',
  vertical?: string | null,
): string {
  return buildArtDirectedPrompt({ subject: prompt, slot, vertical });
}
