/**
 * Deterministic theme-style selector — maps a business's declared vertical
 * category + freeform design-style hint to one of the template's visual
 * personality PRESETS, emitted as the top-level `_brand.json.themeStyle`.
 *
 * WHY (producer gap, found 2026-09-08): the template
 * (`template/src/themePresets.ts` + `brand.ts`) ships 13 cohesive personalities
 * (font pairing + radius + shadow + motion + `data-style` flourish), but the
 * workflow only ever seeded `businessClass='organization'` and NEVER wrote a
 * `themeStyle`. `brand.ts`'s fallback (`presetForClass('organization')`) then
 * pinned EVERY workflow-built site to `classic`, leaving luxe / heritage /
 * precision / boutique / scholarly / botanical UNREACHABLE — generated sites
 * felt same-y regardless of vertical. This closes the gap: the /create form's
 * Industry/Category (18 verticals) + "Additional details" design hint now drive
 * the site's visual personality.
 *
 * Precedence: an explicit design-style KEYWORD in the hint wins (the user asked
 * for it by name); else the declared category's vertical default; else
 * `undefined` — so `brand.ts` keeps its own graceful `classic` fallback and a
 * caller can omit the key entirely.
 *
 * Pure. Never throws. Names MUST stay a subset of the template's `PRESET_NAMES`
 * — the invariant test in `theme_style.test.ts` guards against drift.
 */

/**
 * The 13 template preset names — a mirror of `PRESET_NAMES` in
 * `template/src/themePresets.ts`. Kept as a local literal because the template
 * lives in a separate repo the worker cannot import; the invariant test asserts
 * this list matches what the template ships.
 */
export const THEME_STYLE_NAMES = [
  'classic',
  'editorial',
  'warm',
  'luxe',
  'brutalist',
  'bold',
  'futuristic',
  'rugged',
  'botanical',
  'boutique',
  'precision',
  'heritage',
  'scholarly',
] as const;

/** Union of valid preset names. */
export type ThemeStyleName = (typeof THEME_STYLE_NAMES)[number];

/**
 * Ordered design-hint keyword → preset. The FIRST matching rule wins, so the
 * most distinctive / rarely-reachable personalities (luxe, heritage, precision)
 * are checked before the broad ones. Scanned against the lowercased hint.
 */
const HINT_RULES: ReadonlyArray<readonly [ThemeStyleName, RegExp]> = [
  [
    'luxe',
    /\b(luxur\w*|elegan\w*|premium|upscale|high[-\s]?end|sophisticat\w*|refined|opulent|exclusive|glamou?r\w*|couture|bespoke|lavish)\b/,
  ],
  [
    'heritage',
    /\b(heritage|timeless|traditional|establish\w*|authoritative|corporate|institutional|dignified|old[-\s]?money|trustworthy|trusted|reputable|prestigious|stately)\b/,
  ],
  [
    'precision',
    /\b(precision|engineered|machined|metallic|technical|high[-\s]?performance|motorsport|aerospace|billet)\b/,
  ],
  [
    'futuristic',
    /\b(futuristic|sleek|glassy|gradient|neon|cyber\w*|high[-\s]?tech|hi[-\s]?tech|space[-\s]?age|holograph\w*)\b/,
  ],
  [
    'brutalist',
    /\b(brutalist|brutal|raw|edgy|stark|avant[-\s]?garde|experimental|anti[-\s]?design|striking|maximalist)\b/,
  ],
  [
    'bold',
    /\b(bold|energetic|dynamic|athletic|kinetic|high[-\s]?energy|powerful|punchy|loud|fierce|aggressive)\b/,
  ],
  [
    'botanical',
    /\b(botanical|organic|natural|calm\w*|serene|soothing|fresh|zen|holistic|earthy|eco[-\s]?friendly)\b/,
  ],
  [
    'warm',
    /\b(warm|cozy|cosy|inviting|friendly|welcoming|homey|homely|rustic|approachable|comfortable|hearth|hospitable)\b/,
  ],
  ['boutique', /\b(chic|fashionable|stylish|trendy|tactile|curated|shoppable|artisan\w*)\b/],
  [
    'scholarly',
    /\b(playful|whimsical|cheerful|bright|fun|kid[-\s]?friendly|encouraging|scholarly)\b/,
  ],
  ['editorial', /\b(editorial|magazine|literary|journal\w*|understated)\b/],
];

/**
 * Ordered vertical-category → preset. The FIRST matching rule wins. Scanned
 * against the lowercased category, so both the /create dropdown labels
 * ("Financial / Accounting", "Real Estate", …) and freeform categories resolve.
 */
const CATEGORY_RULES: ReadonlyArray<readonly [ThemeStyleName, RegExp]> = [
  [
    'botanical',
    /\b(beauty|spa|wellness|medical|health\w*|dental|dentist|clinic|therap\w*|chiropract\w*|veterinar\w*|optometr\w*)\b/,
  ],
  [
    'heritage',
    /\b(financ\w*|account\w*|insurance|wealth|advisor\w*|bank\w*|\btax\b|bookkeep\w*)\b/,
  ],
  [
    'precision',
    /\b(automotive|\bauto\b|\bcar\b|dealership|vehicle|mechanic|motorsport|machinery)\b/,
  ],
  [
    'scholarly',
    /\b(education|tutor\w*|school|academy|course|coaching|learning|\bkids\b|children)\b/,
  ],
  [
    'luxe',
    /\b(real[-\s]?estate|realty|realtor|jewel\w*|fine[-\s]?dining|hospitality|hotel|resort)\b/,
  ],
  // warm BEFORE boutique so "Coffee Shop" / "Bakery" match food (warm) rather
  // than the generic `\bshop\b` in boutique.
  [
    'warm',
    /\b(restaurant|caf[eé]|bakery|coffee|\bbar\b|brewery|\bpub\b|bistro|diner|eatery|salon|barber)\b/,
  ],
  [
    'boutique',
    /\b(retail|\bshop\b|\bstore\b|boutique|apparel|clothing|fashion|merchandise|goods)\b/,
  ],
  [
    'futuristic',
    /\b(technology|\btech\b|saas|software|startup|\bapp\b|platform|\bai\b|fintech|developer)\b/,
  ],
  [
    'rugged',
    /\b(construction|home[-\s]?services|trades?|plumb\w*|\bhvac\b|roof\w*|electric\w*|contractor|landscap\w*|manufactur\w*|logistics)\b/,
  ],
  ['bold', /\b(fitness|\bgym\b|crossfit|sport\w*|martial[-\s]?arts|athletic)\b/],
  [
    'brutalist',
    /\b(photograph\w*|creative|portfolio|\bart\b|design[-\s]?studio|agency|\bfilm\b|\bmusic\b)\b/,
  ],
  [
    'editorial',
    /\b(legal|\blaw\b|attorney|lawyer|nonprofit|non[-\s]?profit|charit\w*|foundation)\b/,
  ],
];

/** Return the preset of the first rule whose regex matches `text`. */
function firstMatch(
  text: string,
  rules: ReadonlyArray<readonly [ThemeStyleName, RegExp]>,
): ThemeStyleName | undefined {
  for (const [name, re] of rules) {
    if (re.test(text)) return name;
  }
  return undefined;
}

/**
 * Choose a template theme-style personality from a declared category and/or a
 * freeform design-style hint.
 *
 * @param category - The declared vertical (e.g. `"Financial / Accounting"`,
 *   `"Real Estate"`, a freeform category string) — the /create Industry field.
 * @param designHint - Freeform "Additional details" text where a user may name a
 *   look (e.g. `"elegant luxury feel"`, `"bold and energetic"`).
 * @returns One of the 13 template preset names, or `undefined` when nothing
 *   matches (the caller then omits `themeStyle` and the template falls back to
 *   its own `classic` default). Never throws.
 *
 * @example
 * themeStyleFromInputs('Financial / Accounting')            // → 'heritage'
 * themeStyleFromInputs('Retail / Shop', 'elegant luxury')   // → 'luxe'  (hint wins)
 * themeStyleFromInputs('Automotive')                        // → 'precision'
 * themeStyleFromInputs('Other')                             // → undefined
 */
export function themeStyleFromInputs(
  category?: string | null,
  designHint?: string | null,
): ThemeStyleName | undefined {
  const hint = typeof designHint === 'string' ? designHint.toLowerCase() : '';
  if (hint) {
    const byHint = firstMatch(hint, HINT_RULES);
    if (byHint) return byHint;
  }
  const cat = typeof category === 'string' ? category.toLowerCase() : '';
  if (cat) {
    const byCat = firstMatch(cat, CATEGORY_RULES);
    if (byCat) return byCat;
  }
  return undefined;
}
