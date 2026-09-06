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
 * module upgrades each theme into a full, concrete DOSSIER (typography, EXACT
 * fonts, color treatment, geometry, depth, motion, texture, iconography, imagery,
 * micro-interactions, voice, hero, layout, signature detail) so the AI produces
 * dramatically more elaborate, distinctive, on-personality sites.
 * {@link renderThemeDossier} turns a dossier into the prompt block.
 *
 * WHY the FONTS block is MANDATORY + copy-pastable (ground-truth, 2026-09-06):
 * every deployed generated site (vanta-strength-austin, ironhaus-houston,
 * vantage-digital-studio-portland) shipped with headings in `system-ui` /
 * `-apple-system` — the `typography` PROSE facet ("Oswald condensed uppercase
 * headings…") never landed as a real `font-family`. Prose the generator has to
 * translate gets dropped under the 14-minute build budget. So the dossier now
 * emits the EXACT `<link href>` + the EXACT `--font-heading`/`--font-body` CSS
 * stacks the build can copy verbatim, plus a hard "a build whose headings
 * compute to system-ui has NOT applied this theme" mandate. Typography is the
 * #1 theme signal; making it land is the biggest single elaboration win.
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
  /** Exact CSS `font-family` value for headings (drop into `--font-heading`). */
  readonly headingStack: string;
  /** Exact CSS `font-family` value for body (drop into `--font-body`). */
  readonly bodyStack: string;
  /** Exact Google Fonts stylesheet `href` to add to `<head>` (loads both fonts). */
  readonly googleFontsHref: string;
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
  /** Icon style — stroke weight, fill, corner, source library, sizing. */
  readonly iconography: string;
  /** Art direction for photography/illustration — treatment, crop, overlay. */
  readonly imagery: string;
  /** Micro-interactions — cursor, hover choreography, section transitions, focus. */
  readonly interactions: string;
  /** Microcopy voice — tone of CTAs, headlines, empty/loading states. */
  readonly voice: string;
  /** The signature hero treatment. */
  readonly hero: string;
  /** Composition rhythm — symmetric / asymmetric / editorial grid / bento. */
  readonly layout: string;
  /** The one recognizable detail that makes this theme unmistakable. */
  readonly signature: string;
}

/**
 * The 16 named themes. Keys are the `themeStyle` values referenced by
 * {@link CreateComponent.getDesignRecommendations}; every value there MUST have
 * an entry here (enforced by theme-presets.spec.ts). `classic` is the fallback.
 */
export const THEME_PRESETS: Record<string, ThemeDossier> = {
  classic: {
    label: 'Modern Classic',
    essence: 'Timeless, confident, uncluttered — content-forward with nothing to prove.',
    typography:
      'Montserrat headings (semibold, slight negative tracking) with Inter body on a clean 1.25 type scale; clear H1→H3 hierarchy.',
    headingStack: "'Montserrat', system-ui, sans-serif",
    bodyStack: "'Inter', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Inter:wght@400;500;600&display=swap',
    color:
      'Deep indigo-black canvas, one warm accent, a 3-tone neutral ramp, and generous whitespace — 85% neutral, 15% accent.',
    geometry: '8px card radius, subtle 1px borders, a disciplined 12-column grid.',
    depth: 'Soft diffuse shadows on cards (0 8px 24px at low opacity); flat elsewhere.',
    motion: '300ms ease-out fade-up on scroll, gentle hover lift (translateY -2px).',
    texture: 'Flat matte surface with a single subtle top gradient wash.',
    iconography:
      'Lucide 1.5px stroke line icons, no fill, matched to the accent on hover; consistent 24px sizing.',
    imagery:
      'Clean, well-lit editorial photography, natural color, subtle rounded masks — no heavy filters.',
    interactions:
      'Nav underline grows on hover, cards lift 2px, buttons darken 8%, smooth 300ms crossfade page transitions.',
    voice: 'Clear, professional, benefit-first — confident sentences, no hype words, action-verb CTAs.',
    hero: 'Split hero — left headline + primary CTA, right brand image with a soft shadow.',
    layout: 'Symmetric, balanced, predictable rhythm; roomy sections.',
    signature: 'An accent underline that grows beneath the active nav link.',
  },
  warm: {
    label: 'Warm Hospitality',
    essence: 'Inviting, appetizing, human — you can almost smell the kitchen.',
    typography:
      'Playfair Display headings (elegant serif, true italics for accents) with Lato body; large appetite-driving hero type.',
    headingStack: "'Playfair Display', Georgia, serif",
    bodyStack: "'Lato', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,500&family=Lato:wght@400;700&display=swap',
    color:
      'Espresso-brown base, cream sections, honey/terracotta accent; food photography leads the palette.',
    geometry: '16px soft radius, rounded image masks, organic curved/wave section dividers.',
    depth: 'Warm soft shadows and layered photo cards.',
    motion: 'Slow Ken-Burns zoom on the hero food photo, fade-in on menu items.',
    texture: 'Subtle paper/linen grain on cream sections; warm gradient overlays on photos.',
    iconography:
      'Rounded hand-warmth line icons (Phosphor duotone) in terracotta; small utensil/leaf glyphs beside headings.',
    imagery:
      'Close-up, steam-and-texture food photography with warm golden-hour grade; shallow depth of field.',
    interactions:
      'Menu items fade+rise on scroll, dish cards warm-glow on hover, a gentle reservation CTA pulse.',
    voice: 'Warm, sensory, first-person-plural ("our kitchen") — invites you in, describes taste and welcome.',
    hero: 'Full-bleed ambiance photo, dark warm overlay, centered serif name + reservation CTA.',
    layout: 'Alternating photo/text rows; menu as an elegant two-column price list.',
    signature: 'A hand-drawn underline or utensil/leaf motif beside section titles.',
  },
  luxe: {
    label: 'Quiet Luxe',
    essence: 'Understated premium — every element whispers quality, never shouts.',
    typography:
      'Cormorant Garamond / Libre Baskerville display at generous size with Raleway body; small-caps eyebrows, tight tracking.',
    headingStack: "'Cormorant Garamond', Georgia, serif",
    bodyStack: "'Raleway', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Raleway:wght@400;500;600&display=swap',
    color:
      'Near-black canvas with a champagne-gold accent used ONLY on hairlines + CTAs; 90% neutral, 10% metal.',
    geometry: 'Minimal 2–4px radii, hairline 1px gold dividers at 20% opacity, wide deep margins.',
    depth: 'No drop shadows — separate planes with tonal shifts and thin rules.',
    motion: 'Slow 600–800ms fades and 1.05 image zooms on scroll; nothing bouncy.',
    texture: 'Matte charcoal with a faint film grain; an optional brushed-metal accent bar.',
    iconography:
      'Ultra-thin 1px line icons, gold on hover only, sparse — used as punctuation, never decoration.',
    imagery:
      'Dim, moody, high-craft photography with deep shadows and a single light source; muted desaturated grade.',
    interactions:
      'Gold hairline draws itself in on scroll, CTAs fill slowly from left, cursor-follow spotlight on the hero.',
    voice: 'Sparse, declarative, understated — short lines, no exclamation, quiet confidence over persuasion.',
    hero: 'Full-bleed dim photograph, centered wordmark, a single gold-underlined CTA.',
    layout: 'Lavish negative space, asymmetric two-column feature rows, deep vertical rhythm.',
    signature: 'A thin gold rule that draws itself in on scroll beneath each section title.',
  },
  editorial: {
    label: 'Editorial Authority',
    essence: 'Authoritative, literate, trustworthy — reads like a respected journal.',
    typography:
      'Merriweather serif headings with Source Sans Pro body; magazine hierarchy, drop-cap intros, pull-quotes.',
    headingStack: "'Merriweather', Georgia, serif",
    bodyStack: "'Source Sans 3', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Merriweather:wght@700;900&family=Source+Sans+3:wght@400;600&display=swap',
    color: 'Deep navy and parchment with a restrained gold accent; high text contrast.',
    geometry: 'Crisp 4px radius, ruled column separators, a strict baseline grid.',
    depth: 'Near-flat and print-like; thin rules chosen over shadows.',
    motion: 'Minimal — text fades in, no gimmicks; the gravitas carries it.',
    texture: 'Clean paper-white body with subtle column rules.',
    iconography:
      'Minimal editorial glyphs (thin line), numbered-section markers, a small byline/clock icon in metadata rows.',
    imagery:
      'Documentary black-and-white or muted architectural photography with captions; credited, journalistic framing.',
    interactions:
      'Drop-cap fades in first, pull-quotes slide from the margin, a reading-progress rule tracks scroll.',
    voice: 'Measured, literate, third-person authority — leads with the thesis, cites, never hypes.',
    hero: 'Large serif headline over a muted architectural photo with a byline-style subhead.',
    layout: 'Multi-column editorial grid, a sidebar for practice areas / credentials.',
    signature: 'A numbered-section rhythm with a drop-cap opening each major block.',
  },
  futuristic: {
    label: 'Luminous Futurism',
    essence: 'Sleek, luminous, forward — a product from just over the horizon.',
    typography:
      'Space Grotesk headings with Inter body; tight tracking and mono captions for data/specs.',
    headingStack: "'Space Grotesk', system-ui, sans-serif",
    bodyStack: "'Inter', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500&display=swap',
    color:
      'Deep space-black (#0f0f23) canvas, electric indigo→cyan gradients, neon accents on interactive elements.',
    geometry: '12px radius glass cards, 1px luminous borders, a bento-grid feature layout.',
    depth: 'Glassmorphism (backdrop-blur + translucent fills) with colored glow shadows.',
    motion: 'Parallax layers, animated gradient meshes, count-up stats, hover glow.',
    texture: 'Dark glass over an animated gradient-mesh background with faint grid lines.',
    iconography:
      'Neon-outline glyphs with a soft glow, 1.5px stroke, gradient-stroked on hover; occasional animated line icons.',
    imagery:
      'Product-UI mockups, abstract 3D renders, and gradient-mesh backdrops — never stock photos of people.',
    interactions:
      'Cards tilt on pointer (subtle 3D), gradient borders trace CTAs, magnetic buttons, count-up on scroll-into-view.',
    voice: 'Crisp, spec-forward, present-tense — capability statements and numbers, minimal adjectives.',
    hero: 'A product-UI mock floating over a gradient-mesh backdrop with orbiting accents.',
    layout: 'Asymmetric bento grid of varied-size feature cards.',
    signature: 'An animated gradient border that traces the primary CTA.',
  },
  bold: {
    label: 'Kinetic Bold',
    essence: 'High-energy, kinetic, loud — it grabs you by the collar.',
    typography:
      'Oswald condensed uppercase headings (huge, tight) with Roboto body; oversized numerals.',
    headingStack: "'Oswald', system-ui, sans-serif",
    bodyStack: "'Roboto', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Roboto:wght@400;500&display=swap',
    color:
      'Near-black with a single electric accent (volt/red); high contrast and diagonal color blocks.',
    geometry: 'Sharp 0–4px radius, thick 3px borders, diagonal/skew section cuts.',
    depth: 'Hard offset shadows and stacked poster layers.',
    motion: 'Fast punchy 200ms transitions, scroll-triggered slide-ins, a marquee ticker.',
    texture: 'A gritty overlay with halftone or motion-blur accents on action photos.',
    iconography:
      'Bold filled/duotone icons with thick strokes, oversized, often rotated slightly for energy.',
    imagery:
      'High-contrast action photography with motion blur and a duotone accent wash; aggressive crops.',
    interactions:
      'Buttons snap+shift on hover, a marquee ticker scrolls, stat numbers count up fast, diagonal wipes between sections.',
    voice: 'Punchy, imperative, ALL-CAPS CTAs ("JOIN NOW") — short shout-lines, momentum over nuance.',
    hero: 'Full-bleed action shot, a giant diagonal headline, an aggressive "JOIN NOW" CTA.',
    layout: 'Poster-like blocks, diagonal dividers, an oversized stat band.',
    signature: 'A diagonal accent slash cutting across every section transition.',
  },
  rugged: {
    label: 'Industrial Rugged',
    essence: 'Solid, dependable, industrial — built like the work it advertises.',
    typography: 'Roboto Slab headings (heavy) with Roboto body; stencil-style eyebrows.',
    headingStack: "'Roboto Slab', Georgia, serif",
    bodyStack: "'Roboto', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@600;700;800&family=Roboto:wght@400;500&display=swap',
    color: 'Slate/charcoal with a safety-orange or amber accent over concrete-gray neutrals.',
    geometry: 'Squared 2px radius, heavy 2–3px borders, blueprint grid overlays.',
    depth: 'Strong grounded shadows; cards stacked like plans on a desk.',
    motion: 'Sturdy 350ms slides (no float) and counters for years/projects completed.',
    texture: 'Concrete/brushed-metal surfaces with subtle diagonal hazard-stripe accents.',
    iconography:
      'Heavy 2.5px stroke industrial glyphs (wrench, hard-hat, gauge), squared caps, amber on hover.',
    imagery:
      'Gritty on-site job photography — real crews, machinery, before/after — natural high-contrast grade.',
    interactions:
      'Cards slide in like sheets onto a desk, counters tick up on scroll, a before/after slider drags with grip.',
    voice: 'Plain-spoken, credential-forward, no-nonsense — "we show up, we finish"; licenses and years up front.',
    hero: 'Full-bleed job-site photo, a bold headline, a "GET FREE ESTIMATE" block CTA.',
    layout: 'Strong horizontal bands, a before/after slider, a process-steps row.',
    signature: 'A hazard-stripe or rivet accent bar framing key CTAs.',
  },
  brutalist: {
    label: 'Gallery Brutalist',
    essence: 'Raw, gallery-grade, image-first — the work needs no decoration.',
    typography:
      'DM Sans throughout with stark weight contrast, oversized lowercase, monospaced (DM Mono) captions.',
    headingStack: "'DM Sans', system-ui, sans-serif",
    bodyStack: "'DM Sans', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700;900&family=DM+Mono:wght@400;500&display=swap',
    color: 'Pure black and white with near-zero accent — the imagery IS the color.',
    geometry: 'Zero radius, exposed 1px grid lines, edge-to-edge full-bleed blocks.',
    depth: 'Flat, no shadow; separation via raw borders and deliberate whitespace voids.',
    motion: 'Minimal — hard cuts, image reveal on scroll, a cursor-follow caption.',
    texture: 'None; clean paper-white gutters and honest structure.',
    iconography:
      'Almost none — monospaced index numbers and arrows instead of icons; when used, unstyled 1px system glyphs.',
    imagery:
      'Full-bleed, uncropped, unfiltered photography at maximum size; the image is the interface.',
    interactions:
      'Hard cuts (no fades), a monospace caption follows the cursor, images snap into view, links invert on hover.',
    voice: 'Terse, lowercase, matter-of-fact — labels and index numbers, no marketing sentences.',
    hero: 'A full-screen single photograph, a tiny corner wordmark, no overlay.',
    layout: 'Asymmetric masonry / broken grid with intentional empty cells.',
    signature: 'Exposed grid lines and monospace index numbers labeling each work.',
  },
  botanical: {
    label: 'Botanical Calm',
    essence: 'Calming, fresh, clinically reassuring — you exhale on arrival.',
    typography:
      'Poppins rounded headings with Open Sans body; soft, highly legible, generous line-height.',
    headingStack: "'Poppins', system-ui, sans-serif",
    bodyStack: "'Open Sans', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Open+Sans:wght@400;600&display=swap',
    color:
      'Soft white/mint canvas with sage-green and sky-blue accents over warm neutral text — airy and clean.',
    geometry: '20px soft radius, pill buttons, gentle organic blob/leaf dividers.',
    depth: 'Very soft ambient shadows; floating rounded cards.',
    motion: 'Calm 400ms fades and a gentle float on cards; no sudden movement.',
    texture: 'Subtle organic leaf/wave motifs and soft gradient washes (mint→white).',
    iconography:
      'Rounded, friendly duotone icons in sage/sky, generous padding, leaf and heart-pulse motifs.',
    imagery:
      'Bright, airy, natural-light photography of calm faces and green spaces; soft high-key grade.',
    interactions:
      'Cards float gently on hover, blobs drift slowly in the background, booking CTA breathes with a soft pulse.',
    voice: 'Warm, reassuring, plain-language — patient-first, calming ("we’ve got you"), zero jargon.',
    hero: 'A bright welcoming facility photo with a rounded overlay card and booking CTA.',
    layout: 'Roomy, symmetric, reassuring; provider cards in a soft grid.',
    signature: 'A recurring leaf / organic-curve motif separating each section.',
  },
  boutique: {
    label: 'Chic Boutique',
    essence: 'Chic, tactile, covetable — a curated shop you want to linger in.',
    typography:
      'Fraunces / Cormorant display with Jost body; a fashion-editorial pairing with elegant tracking.',
    headingStack: "'Fraunces', Georgia, serif",
    bodyStack: "'Jost', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;0,600;1,500&family=Jost:wght@400;500&display=swap',
    color:
      'Warm ivory/blush base, one deep accent (plum or emerald), gold micro-accents; product-forward.',
    geometry: '12px radius, thin elegant borders, a generous product grid.',
    depth: 'Soft product-card shadows with a subtle hover lift + image swap.',
    motion: 'Refined 350ms fades, a hover product-image crossfade, quick-add micro-interactions.',
    texture: 'Soft paper/fabric grain with tasteful gradient section breaks.',
    iconography:
      'Delicate thin-line boutique glyphs (bag, heart, tag) in the deep accent; gold on hover.',
    imagery:
      'Editorial lookbook photography — styled flat-lays and model shots on ivory, soft warm grade.',
    interactions:
      'Product cards crossfade to a second image on hover, a quick-add slides up, "shop the look" hotspots reveal.',
    voice: 'Editorial, tactile, aspirational — describes materials and feel; "add to bag", "shop the edit".',
    hero: 'An editorial lookbook hero — model/product photo with an elegant "Shop" CTA.',
    layout: 'Lookbook rows above a shoppable product grid and category tiles.',
    signature: 'A "shop the look" hover-reveal hotspot on product cards.',
  },
  precision: {
    label: 'Precision Engineered',
    essence: 'Engineered, sharp, kinetic-metallic — performance you can feel.',
    typography:
      'Rajdhani / technical display headings with Inter body; wide tracking and mono spec labels.',
    headingStack: "'Rajdhani', system-ui, sans-serif",
    bodyStack: "'Inter', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500&display=swap',
    color:
      'Gunmetal/graphite base, chrome-silver plus one racing accent (red or electric-blue); metallic gradients.',
    geometry: 'Sharp 2px radius, precise 1px borders, a spec-sheet-aligned grid.',
    depth: 'Crisp inner + drop shadows with glass-reflection highlights on cards.',
    motion: 'Fast precise 250ms slides, a speedometer/gauge count-up, a hover shine sweep.',
    texture: 'Brushed-metal and carbon-fiber accents with subtle reflective gradients.',
    iconography:
      'Technical thin-line glyphs with mono spec labels (gauge, gear, bolt), chrome stroke, precise 20px grid.',
    imagery:
      'Dramatic machine/vehicle photography — three-quarter hero angles, studio rim-light, chrome reflections.',
    interactions:
      'A chrome shine sweeps across CTAs, gauges count up, spec chips slide in row-by-row, hover reveals tech captions.',
    voice: 'Precise, spec-driven, performance-forward — numbers, tolerances, "engineered to"; confident and technical.',
    hero: 'A dramatic full-bleed vehicle/machine shot, an angular headline, spec chips.',
    layout: 'Spec-grid feature rows, comparison tables, a gallery with technical captions.',
    signature: 'A chrome shine-sweep across CTAs and spec-chip data rows.',
  },
  heritage: {
    label: 'Established Heritage',
    essence: 'Timeless, established, unshakeably trustworthy — decades of standing.',
    typography:
      'Playfair Display / Libre Baskerville serif headings with Source Sans Pro body; formal, measured hierarchy.',
    headingStack: "'Playfair Display', Georgia, serif",
    bodyStack: "'Source Sans 3', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;900&family=Source+Sans+3:wght@400;600&display=swap',
    color:
      'Deep navy/oxblood base, ivory sections, a restrained brass-gold accent; conservative, high contrast.',
    geometry: '4px radius, engraved 1px rules, a columned classical grid, a crest/seal motif.',
    depth: 'Subtle print-like elevation with framed sections.',
    motion: 'Dignified slow fades and count-ups for years/clients/AUM; nothing flashy.',
    texture: 'Subtle guilloché/engraving pattern accents on an ivory paper feel.',
    iconography:
      'Engraved-line heraldic glyphs (crest, columns, scales, laurel) in brass; formal, symmetrical.',
    imagery:
      'Formal architectural and portrait photography — columns, boardrooms, handshakes; muted navy-and-ivory grade.',
    interactions:
      'A fine engraved rule draws in beneath titles, year/AUM counters tick up slowly, framed sections fade in.',
    voice: 'Formal, measured, credential-first — "since 19XX", fiduciary and steady; reassurance over urgency.',
    hero: 'An authoritative navy hero, a serif headline, a seal/crest emblem, a consultation CTA.',
    layout: 'Structured columns, a credential/badge strip, a service-tiers table.',
    signature: 'A fine engraved rule and a seal/monogram emblem anchoring the header.',
  },
  scholarly: {
    label: 'Bright Scholarly',
    essence: 'Bright, approachable, encouraging — learning should feel welcoming.',
    typography:
      'Poppins / Quicksand rounded headings with Nunito body; friendly, highly legible, a playful scale.',
    headingStack: "'Poppins', system-ui, sans-serif",
    bodyStack: "'Nunito', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Nunito:wght@400;700&display=swap',
    color:
      'A cheerful bright base (sky/sunflower/coral) with clean white cards; optimistic and high-contrast.',
    geometry: '20px rounded radius, pill tags, playful blob/underline accents.',
    depth: 'Soft friendly shadows; cards that lift and tilt slightly on hover.',
    motion: 'A tasteful 300ms spring and small confetti/star moments on key CTAs.',
    texture: 'Subtle hand-drawn doodle/underline accents and soft gradient blobs.',
    iconography:
      'Rounded, colorful filled icons (books, stars, lightbulbs) with a playful bounce on hover.',
    imagery:
      'Bright, candid photography of engaged students and mentors; warm optimistic grade, natural smiles.',
    interactions:
      'Cards spring+tilt on hover, a star/confetti pops on enroll, progress bars fill, underlines draw in.',
    voice: 'Encouraging, warm, second-person ("you’ll master…") — celebrates progress, friendly and clear.',
    hero: 'A warm classroom/student photo with a rounded card headline and an "Enroll" CTA.',
    layout: 'Friendly card grids, program tiles, testimonial bubbles.',
    signature: 'Hand-drawn underlines and a recurring star/spark accent on highlights.',
  },
  noir: {
    label: 'Cinematic Noir',
    essence: 'Intimate, cinematic, after-dark — a speakeasy you were lucky to find.',
    typography:
      'Cinzel engraved-caps headings (wide, dramatic) with Manrope body; small-caps eyebrows, deep letter-spacing.',
    headingStack: "'Cinzel', Georgia, serif",
    bodyStack: "'Manrope', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=Manrope:wght@400;500;600&display=swap',
    color:
      'Near-black (#0e0e12) canvas, deep oxblood/emerald pools, a single antique-brass accent on CTAs and hairlines.',
    geometry: 'Sharp 2px radius, thin brass hairline dividers, wide theatrical margins, a centered spotlight column.',
    depth: 'Deep vignette shadows and a single-source glow — planes emerge from darkness, no flat cards.',
    motion: 'Slow 700ms cross-dissolves, a spotlight that follows scroll, letters that fade up like a title card.',
    texture: 'Matte black with heavy film grain, a faint smoke/haze gradient, and brushed-brass accent bars.',
    iconography:
      'Thin art-deco line glyphs (coupe, key, moon) in antique brass, symmetrical, used sparingly as punctuation.',
    imagery:
      'Low-key chiaroscuro photography — single warm light, deep shadow, amber-on-black grade; moody and intimate.',
    interactions:
      'A cursor-follow spotlight lifts content from the dark, CTAs fill with brass on hover, sections cross-dissolve.',
    voice: 'Suggestive, restrained, cinematic — short evocative lines ("after dark, we pour"), mystery over volume.',
    hero: 'A near-black hero with a single warm spotlight on the wordmark and one brass-underlined "Reserve" CTA.',
    layout: 'Centered theatrical column with deep vertical rhythm; asymmetric feature rows emerging from black.',
    signature: 'A moving spotlight/vignette that reveals each section as it scrolls into the light.',
  },
  artisan: {
    label: 'Handcrafted Artisan',
    essence: 'Handmade, earthy, honest — you can feel the maker’s hand in every detail.',
    typography:
      'Spectral literary-serif headings (warm, humanist italics for accents) with Karla body; relaxed line-height.',
    headingStack: "'Spectral', Georgia, serif",
    bodyStack: "'Karla', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,500;0,600;1,400&family=Karla:wght@400;600&display=swap',
    color:
      'Warm oat/kraft-paper base, clay-terracotta and sage accents, ink-brown text; earthy, natural, low-saturation.',
    geometry: 'Soft 14px radius, hand-torn/deckled edges, irregular organic dividers, an unfussy off-grid rhythm.',
    depth: 'Soft paper-shadow layering; elements sit like pressed prints on kraft stock.',
    motion: 'Gentle 450ms fades, a subtle ink-bleed reveal on headings, slow parallax on textured backgrounds.',
    texture: 'Recycled-paper / linen grain, faint watercolor washes, a hand-stamped ink accent.',
    iconography:
      'Hand-drawn, slightly irregular line icons (leaf, thread, kiln, jar) in ink-brown; imperfect on purpose.',
    imagery:
      'Tactile process photography — hands at work, raw materials, workshop light; warm matte film grade.',
    interactions:
      'Headings ink-bleed into view, cards lift like lifting paper, a stamped seal presses in on hover of CTAs.',
    voice: 'Honest, personal, maker-first — small-batch story, provenance and craft; humble, never corporate.',
    hero: 'A warm workshop photo with a torn-paper overlay card, a hand-stamped logo, and a "Our Story" CTA.',
    layout: 'Off-grid editorial rhythm; alternating story blocks and a tactile product/process gallery.',
    signature: 'A hand-stamped ink seal and torn-paper edges framing feature sections.',
  },
  retro: {
    label: 'Nostalgic Retro',
    essence: 'Nostalgic, playful, joyfully vintage — a fond throwback with modern polish.',
    typography:
      'Bricolage Grotesque display headings (chunky, characterful) with DM Sans body; oversized retro numerals.',
    headingStack: "'Bricolage Grotesque', system-ui, sans-serif",
    bodyStack: "'DM Sans', system-ui, sans-serif",
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700;800&family=DM+Sans:wght@400;500&display=swap',
    color:
      'Cream/butter base with a warm 70s palette — mustard, rust-orange, avocado, teal; bold blocks, high warmth.',
    geometry: 'Rounded 18px radius, thick retro outlines, arched/rounded section tops, a chunky sticker rhythm.',
    depth: 'Flat retro sticker layers with hard 4px offset color shadows; playful stacked badges.',
    motion: 'Bouncy 300ms spring pops, a scrolling retro marquee, badges that wobble slightly on hover.',
    texture: 'Subtle paper/print halftone dots, sunburst rays, and grainy warm gradients.',
    iconography:
      'Chunky filled retro glyphs and badge/sticker shapes (sunburst, star, arrow) with thick outlines and warm fills.',
    imagery:
      'Warm film-grade photography with slight fade and grain; vintage crops, kodachrome color, nostalgic subjects.',
    interactions:
      'Buttons pop and cast a hard offset shadow on hover, a marquee scrolls, stickers wobble, sunbursts spin slowly.',
    voice: 'Playful, friendly, nostalgic — winking retro copy ("the good stuff, since day one"), warm and fun.',
    hero: 'A cream hero with a chunky arched headline, a sunburst backdrop, retro badges, and a bold rounded CTA.',
    layout: 'Blocky rounded panels, a badge/sticker strip, an arched feature grid with warm color blocks.',
    signature: 'A spinning sunburst and hard-offset color-shadow badges anchoring the hero + CTAs.',
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
 * fully-consistent visual identity instead of a generic template. The FONTS
 * facet is emitted as a COPY-PASTABLE mandate (exact `<link>` + exact CSS
 * stacks) because prose font names ("Oswald headings") were being dropped and
 * every deployed site shipped headings in system-ui — see the module header.
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
    `  • Fonts (MANDATORY — never leave headings in system-ui): add \`<link rel="stylesheet" href="${d.googleFontsHref}">\` to <head>; set CSS custom properties \`--font-heading: ${d.headingStack};\` and \`--font-body: ${d.bodyStack};\`; apply var(--font-heading) to h1–h6, nav and the hero, and var(--font-body) to body. A build whose headings compute to system-ui / -apple-system has NOT applied this theme.`,
    `  • Color treatment: ${d.color}`,
    `  • Geometry: ${d.geometry}`,
    `  • Depth: ${d.depth}`,
    `  • Motion: ${d.motion}`,
    `  • Texture / finish: ${d.texture}`,
    `  • Iconography: ${d.iconography}`,
    `  • Imagery / art direction: ${d.imagery}`,
    `  • Micro-interactions: ${d.interactions}`,
    `  • Voice / microcopy: ${d.voice}`,
    `  • Hero treatment: ${d.hero}`,
    `  • Layout rhythm: ${d.layout}`,
    `  • Signature detail: ${d.signature}`,
    'Apply this design language consistently across every page — the loaded Google Fonts (never system-ui), typography scale, corner radius, shadow character, motion, texture, iconography, imagery grade, micro-interactions, voice, and the signature detail must all read as one coherent, elaborate brand (never a generic template).',
  ].join('\n');
}
