/**
 * theme-presets.ts — the named-theme design-language registry for /create.
 *
 * Every site created from /create carries a `themeStyle` word (chosen by
 * business category in {@link CreateComponent.getDesignRecommendations}). That
 * word is injected into the generation prompt as `additional_context`, which the
 * container orchestrator reads when it builds the site.
 *
 * The OLD injection was a single bare line — `Theme personality: luxe — apply
 * this named visual style` — with NO concrete definition, so the generator had
 * to guess what "luxe" meant and themed sites converged on a generic look. This
 * module upgrades each theme into a full, concrete DOSSIER (typography, color
 * treatment, geometry, depth, motion, texture, hero, layout, signature detail)
 * so the AI produces dramatically more elaborate, distinctive, on-personality
 * sites. {@link renderThemeDossier} turns a dossier into the prompt block.
 *
 * Pure + framework-free so it unit-tests in isolation (theme-presets.spec.ts) —
 * mirrors the claim-prefill.ts sibling-module pattern.
 */

/** A complete, concrete design language for one named theme personality. */
export interface ThemeDossier {
  /** Human-facing label (e.g. "Quiet Luxe"). */
  readonly label: string;
  /** One-line vibe — the feeling the whole site should evoke. */
  readonly essence: string;
  /** Concrete font pairing + treatment (weight, case, tracking, scale). */
  readonly typography: string;
  /** How primary/accent/neutrals are used; contrast + gradient strategy. */
  readonly color: string;
  /** Corner radius, borders, dividers, grid rhythm. */
  readonly geometry: string;
  /** Shadow / elevation character. */
  readonly depth: string;
  /** Animation vocabulary — easing, entrances, hover, scroll. */
  readonly motion: string;
  /** Surface finish — grain, glass, matte, gradient mesh, paper. */
  readonly texture: string;
  /** The signature hero treatment. */
  readonly hero: string;
  /** Composition rhythm — symmetric / asymmetric / editorial grid / bento. */
  readonly layout: string;
  /** The one recognizable detail that makes this theme unmistakable. */
  readonly signature: string;
}

/**
 * The 13 named themes. Keys are the `themeStyle` values referenced by
 * {@link CreateComponent.getDesignRecommendations}; every value there MUST have
 * an entry here (enforced by theme-presets.spec.ts). `classic` is the fallback.
 */
export const THEME_PRESETS: Record<string, ThemeDossier> = {
  classic: {
    label: 'Modern Classic',
    essence: 'Timeless, confident, uncluttered — content-forward with nothing to prove.',
    typography:
      'Montserrat headings (semibold, slight negative tracking) with Inter body on a clean 1.25 type scale; clear H1→H3 hierarchy.',
    color:
      'Deep indigo-black canvas, one warm accent, a 3-tone neutral ramp, and generous whitespace — 85% neutral, 15% accent.',
    geometry: '8px card radius, subtle 1px borders, a disciplined 12-column grid.',
    depth: 'Soft diffuse shadows on cards (0 8px 24px at low opacity); flat elsewhere.',
    motion: '300ms ease-out fade-up on scroll, gentle hover lift (translateY -2px).',
    texture: 'Flat matte surface with a single subtle top gradient wash.',
    hero: 'Split hero — left headline + primary CTA, right brand image with a soft shadow.',
    layout: 'Symmetric, balanced, predictable rhythm; roomy sections.',
    signature: 'An accent underline that grows beneath the active nav link.',
  },
  warm: {
    label: 'Warm Hospitality',
    essence: 'Inviting, appetizing, human — you can almost smell the kitchen.',
    typography:
      'Playfair Display headings (elegant serif, true italics for accents) with Lato body; large appetite-driving hero type.',
    color:
      'Espresso-brown base, cream sections, honey/terracotta accent; food photography leads the palette.',
    geometry: '16px soft radius, rounded image masks, organic curved/wave section dividers.',
    depth: 'Warm soft shadows and layered photo cards.',
    motion: 'Slow Ken-Burns zoom on the hero food photo, fade-in on menu items.',
    texture: 'Subtle paper/linen grain on cream sections; warm gradient overlays on photos.',
    hero: 'Full-bleed ambiance photo, dark warm overlay, centered serif name + reservation CTA.',
    layout: 'Alternating photo/text rows; menu as an elegant two-column price list.',
    signature: 'A hand-drawn underline or utensil/leaf motif beside section titles.',
  },
  luxe: {
    label: 'Quiet Luxe',
    essence: 'Understated premium — every element whispers quality, never shouts.',
    typography:
      'Cormorant Garamond / Libre Baskerville display at generous size with Raleway body; small-caps eyebrows, tight tracking.',
    color:
      'Near-black canvas with a champagne-gold accent used ONLY on hairlines + CTAs; 90% neutral, 10% metal.',
    geometry: 'Minimal 2–4px radii, hairline 1px gold dividers at 20% opacity, wide deep margins.',
    depth: 'No drop shadows — separate planes with tonal shifts and thin rules.',
    motion: 'Slow 600–800ms fades and 1.05 image zooms on scroll; nothing bouncy.',
    texture: 'Matte charcoal with a faint film grain; an optional brushed-metal accent bar.',
    hero: 'Full-bleed dim photograph, centered wordmark, a single gold-underlined CTA.',
    layout: 'Lavish negative space, asymmetric two-column feature rows, deep vertical rhythm.',
    signature: 'A thin gold rule that draws itself in on scroll beneath each section title.',
  },
  editorial: {
    label: 'Editorial Authority',
    essence: 'Authoritative, literate, trustworthy — reads like a respected journal.',
    typography:
      'Merriweather serif headings with Source Sans Pro body; magazine hierarchy, drop-cap intros, pull-quotes.',
    color: 'Deep navy and parchment with a restrained gold accent; high text contrast.',
    geometry: 'Crisp 4px radius, ruled column separators, a strict baseline grid.',
    depth: 'Near-flat and print-like; thin rules chosen over shadows.',
    motion: 'Minimal — text fades in, no gimmicks; the gravitas carries it.',
    texture: 'Clean paper-white body with subtle column rules.',
    hero: 'Large serif headline over a muted architectural photo with a byline-style subhead.',
    layout: 'Multi-column editorial grid, a sidebar for practice areas / credentials.',
    signature: 'A numbered-section rhythm with a drop-cap opening each major block.',
  },
  futuristic: {
    label: 'Luminous Futurism',
    essence: 'Sleek, luminous, forward — a product from just over the horizon.',
    typography:
      'Space Grotesk headings with Inter body; tight tracking and mono captions for data/specs.',
    color:
      'Deep space-black (#0f0f23) canvas, electric indigo→cyan gradients, neon accents on interactive elements.',
    geometry: '12px radius glass cards, 1px luminous borders, a bento-grid feature layout.',
    depth: 'Glassmorphism (backdrop-blur + translucent fills) with colored glow shadows.',
    motion: 'Parallax layers, animated gradient meshes, count-up stats, hover glow.',
    texture: 'Dark glass over an animated gradient-mesh background with faint grid lines.',
    hero: 'A product-UI mock floating over a gradient-mesh backdrop with orbiting accents.',
    layout: 'Asymmetric bento grid of varied-size feature cards.',
    signature: 'An animated gradient border that traces the primary CTA.',
  },
  bold: {
    label: 'Kinetic Bold',
    essence: 'High-energy, kinetic, loud — it grabs you by the collar.',
    typography:
      'Oswald condensed uppercase headings (huge, tight) with Roboto body; oversized numerals.',
    color:
      'Near-black with a single electric accent (volt/red); high contrast and diagonal color blocks.',
    geometry: 'Sharp 0–4px radius, thick 3px borders, diagonal/skew section cuts.',
    depth: 'Hard offset shadows and stacked poster layers.',
    motion: 'Fast punchy 200ms transitions, scroll-triggered slide-ins, a marquee ticker.',
    texture: 'A gritty overlay with halftone or motion-blur accents on action photos.',
    hero: 'Full-bleed action shot, a giant diagonal headline, an aggressive "JOIN NOW" CTA.',
    layout: 'Poster-like blocks, diagonal dividers, an oversized stat band.',
    signature: 'A diagonal accent slash cutting across every section transition.',
  },
  rugged: {
    label: 'Industrial Rugged',
    essence: 'Solid, dependable, industrial — built like the work it advertises.',
    typography: 'Roboto Slab headings (heavy) with Roboto body; stencil-style eyebrows.',
    color: 'Slate/charcoal with a safety-orange or amber accent over concrete-gray neutrals.',
    geometry: 'Squared 2px radius, heavy 2–3px borders, blueprint grid overlays.',
    depth: 'Strong grounded shadows; cards stacked like plans on a desk.',
    motion: 'Sturdy 350ms slides (no float) and counters for years/projects completed.',
    texture: 'Concrete/brushed-metal surfaces with subtle diagonal hazard-stripe accents.',
    hero: 'Full-bleed job-site photo, a bold headline, a "GET FREE ESTIMATE" block CTA.',
    layout: 'Strong horizontal bands, a before/after slider, a process-steps row.',
    signature: 'A hazard-stripe or rivet accent bar framing key CTAs.',
  },
  brutalist: {
    label: 'Gallery Brutalist',
    essence: 'Raw, gallery-grade, image-first — the work needs no decoration.',
    typography:
      'DM Sans throughout with stark weight contrast, oversized lowercase, monospaced captions.',
    color: 'Pure black and white with near-zero accent — the imagery IS the color.',
    geometry: 'Zero radius, exposed 1px grid lines, edge-to-edge full-bleed blocks.',
    depth: 'Flat, no shadow; separation via raw borders and deliberate whitespace voids.',
    motion: 'Minimal — hard cuts, image reveal on scroll, a cursor-follow caption.',
    texture: 'None; clean paper-white gutters and honest structure.',
    hero: 'A full-screen single photograph, a tiny corner wordmark, no overlay.',
    layout: 'Asymmetric masonry / broken grid with intentional empty cells.',
    signature: 'Exposed grid lines and monospace index numbers labeling each work.',
  },
  botanical: {
    label: 'Botanical Calm',
    essence: 'Calming, fresh, clinically reassuring — you exhale on arrival.',
    typography:
      'Poppins rounded headings with Open Sans body; soft, highly legible, generous line-height.',
    color:
      'Soft white/mint canvas with sage-green and sky-blue accents over warm neutral text — airy and clean.',
    geometry: '20px soft radius, pill buttons, gentle organic blob/leaf dividers.',
    depth: 'Very soft ambient shadows; floating rounded cards.',
    motion: 'Calm 400ms fades and a gentle float on cards; no sudden movement.',
    texture: 'Subtle organic leaf/wave motifs and soft gradient washes (mint→white).',
    hero: 'A bright welcoming facility photo with a rounded overlay card and booking CTA.',
    layout: 'Roomy, symmetric, reassuring; provider cards in a soft grid.',
    signature: 'A recurring leaf / organic-curve motif separating each section.',
  },
  boutique: {
    label: 'Chic Boutique',
    essence: 'Chic, tactile, covetable — a curated shop you want to linger in.',
    typography:
      'Fraunces / Cormorant display with Jost body; a fashion-editorial pairing with elegant tracking.',
    color:
      'Warm ivory/blush base, one deep accent (plum or emerald), gold micro-accents; product-forward.',
    geometry: '12px radius, thin elegant borders, a generous product grid.',
    depth: 'Soft product-card shadows with a subtle hover lift + image swap.',
    motion: 'Refined 350ms fades, a hover product-image crossfade, quick-add micro-interactions.',
    texture: 'Soft paper/fabric grain with tasteful gradient section breaks.',
    hero: 'An editorial lookbook hero — model/product photo with an elegant "Shop" CTA.',
    layout: 'Lookbook rows above a shoppable product grid and category tiles.',
    signature: 'A "shop the look" hover-reveal hotspot on product cards.',
  },
  precision: {
    label: 'Precision Engineered',
    essence: 'Engineered, sharp, kinetic-metallic — performance you can feel.',
    typography:
      'Rajdhani / technical display headings with Inter body; wide tracking and mono spec labels.',
    color:
      'Gunmetal/graphite base, chrome-silver plus one racing accent (red or electric-blue); metallic gradients.',
    geometry: 'Sharp 2px radius, precise 1px borders, a spec-sheet-aligned grid.',
    depth: 'Crisp inner + drop shadows with glass-reflection highlights on cards.',
    motion: 'Fast precise 250ms slides, a speedometer/gauge count-up, a hover shine sweep.',
    texture: 'Brushed-metal and carbon-fiber accents with subtle reflective gradients.',
    hero: 'A dramatic full-bleed vehicle/machine shot, an angular headline, spec chips.',
    layout: 'Spec-grid feature rows, comparison tables, a gallery with technical captions.',
    signature: 'A chrome shine-sweep across CTAs and spec-chip data rows.',
  },
  heritage: {
    label: 'Established Heritage',
    essence: 'Timeless, established, unshakeably trustworthy — decades of standing.',
    typography:
      'Playfair Display / Libre Baskerville serif headings with Source Sans Pro body; formal, measured hierarchy.',
    color:
      'Deep navy/oxblood base, ivory sections, a restrained brass-gold accent; conservative, high contrast.',
    geometry: '4px radius, engraved 1px rules, a columned classical grid, a crest/seal motif.',
    depth: 'Subtle print-like elevation with framed sections.',
    motion: 'Dignified slow fades and count-ups for years/clients/AUM; nothing flashy.',
    texture: 'Subtle guilloché/engraving pattern accents on an ivory paper feel.',
    hero: 'An authoritative navy hero, a serif headline, a seal/crest emblem, a consultation CTA.',
    layout: 'Structured columns, a credential/badge strip, a service-tiers table.',
    signature: 'A fine engraved rule and a seal/monogram emblem anchoring the header.',
  },
  scholarly: {
    label: 'Bright Scholarly',
    essence: 'Bright, approachable, encouraging — learning should feel welcoming.',
    typography:
      'Poppins / Quicksand rounded headings with Nunito body; friendly, highly legible, a playful scale.',
    color:
      'A cheerful bright base (sky/sunflower/coral) with clean white cards; optimistic and high-contrast.',
    geometry: '20px rounded radius, pill tags, playful blob/underline accents.',
    depth: 'Soft friendly shadows; cards that lift and tilt slightly on hover.',
    motion: 'A tasteful 300ms spring and small confetti/star moments on key CTAs.',
    texture: 'Subtle hand-drawn doodle/underline accents and soft gradient blobs.',
    hero: 'A warm classroom/student photo with a rounded card headline and an "Enroll" CTA.',
    layout: 'Friendly card grids, program tiles, testimonial bubbles.',
    signature: 'Hand-drawn underlines and a recurring star/spark accent on highlights.',
  },
};

/** All registered theme-style keys (for tests + iteration). */
export const THEME_STYLE_KEYS = Object.keys(THEME_PRESETS);

/** The fallback theme used when a style is unknown/empty. */
export const DEFAULT_THEME_STYLE = 'classic';

/**
 * Render a theme's full design-language dossier as a generation-prompt block.
 *
 * Replaces the old one-line `Theme personality: <word>` hint with a concrete,
 * multi-facet brief so the site generator applies a distinctive, elaborate,
 * fully-consistent visual identity instead of a generic template.
 *
 * @param style - a `themeStyle` key; unknown/empty falls back to `classic`.
 * @returns a multi-line prompt block (bulleted design facets + a consistency mandate).
 * @example
 * renderThemeDossier('luxe');
 * // => 'Theme personality: "Quiet Luxe" (luxe) — Understated premium...\n  • Typography: ...\n  ...'
 */
export function renderThemeDossier(style: string | undefined | null): string {
  const key = style && THEME_PRESETS[style] ? style : DEFAULT_THEME_STYLE;
  const d = THEME_PRESETS[key];
  return [
    `Theme personality: "${d.label}" (${key}) — ${d.essence}`,
    `  • Typography: ${d.typography}`,
    `  • Color treatment: ${d.color}`,
    `  • Geometry: ${d.geometry}`,
    `  • Depth: ${d.depth}`,
    `  • Motion: ${d.motion}`,
    `  • Texture / finish: ${d.texture}`,
    `  • Hero treatment: ${d.hero}`,
    `  • Layout rhythm: ${d.layout}`,
    `  • Signature detail: ${d.signature}`,
    'Apply this design language consistently across every page — typography, corner radius, shadow character, motion, texture, and the signature detail must all read as one coherent, elaborate brand (never a generic template).',
  ].join('\n');
}
