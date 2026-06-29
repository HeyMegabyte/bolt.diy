/**
 * Seasonal hero directive — keep a static SMB site feeling alive year-round (#70).
 *
 * @remarks
 * Pure + deterministic (inject `nowMs`; no `Date.now()` so it's testable): maps a
 * date to a season + an OPTIONAL occasion (only inside a real calendar window —
 * never a forced gimmick), plus an accent hint + a short, tasteful headline
 * prefix. The edge personalizer / one-tap restyle consumes this; `auto-revert`
 * is just "stop applying once the window passes". Occasion is US-centric by
 * default; `occasions: false` disables them for a plain seasonal tint.
 *
 * @packageDocumentation
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Hemisphere = 'north' | 'south';

export type Occasion =
  | 'new_year'
  | 'valentines'
  | 'spring_renewal'
  | 'independence_day'
  | 'back_to_school'
  | 'halloween'
  | 'thanksgiving'
  | 'holidays';

/** The resolved restyle directive. */
export interface SeasonalHero {
  season: Season;
  /** A real, in-window occasion, or null (no forced theming off-window). */
  occasion: Occasion | null;
  /** Accent-color hint (token name the theme maps to a brand-safe shade). */
  accent: string;
  /** Optional tasteful headline prefix, or null. */
  headlinePrefix: string | null;
}

/** Northern-hemisphere season by month (0-indexed). South flips by 6 months. */
function seasonForMonth(month0: number, hemisphere: Hemisphere): Season {
  const north: Season[] = [
    'winter',
    'winter',
    'spring',
    'spring',
    'spring',
    'summer',
    'summer',
    'summer',
    'autumn',
    'autumn',
    'autumn',
    'winter',
  ];
  const base = north[month0];
  if (hemisphere === 'north') return base;
  const flip: Record<Season, Season> = {
    winter: 'summer',
    summer: 'winter',
    spring: 'autumn',
    autumn: 'spring',
  };
  return flip[base];
}

const ACCENT_BY_SEASON: Record<Season, string> = {
  spring: 'accent-bloom',
  summer: 'accent-sun',
  autumn: 'accent-amber',
  winter: 'accent-frost',
};

interface OccWindow {
  occasion: Occasion;
  /** Inclusive [startMonth0, startDay] .. [endMonth0, endDay]. Same-year windows only. */
  from: [number, number];
  to: [number, number];
  accent: string;
  headlinePrefix: string;
}

/** Curated occasion windows (US calendar). Ordered; first match wins. */
const OCCASIONS: readonly OccWindow[] = [
  {
    occasion: 'new_year',
    from: [11, 29],
    to: [11, 31],
    accent: 'accent-gold',
    headlinePrefix: 'New year, new look —',
  },
  {
    occasion: 'new_year',
    from: [0, 1],
    to: [0, 3],
    accent: 'accent-gold',
    headlinePrefix: 'New year, new look —',
  },
  {
    occasion: 'valentines',
    from: [1, 10],
    to: [1, 15],
    accent: 'accent-rose',
    headlinePrefix: 'With love —',
  },
  {
    occasion: 'spring_renewal',
    from: [2, 19],
    to: [2, 25],
    accent: 'accent-bloom',
    headlinePrefix: 'Fresh for spring —',
  },
  {
    occasion: 'independence_day',
    from: [6, 1],
    to: [6, 5],
    accent: 'accent-flag',
    headlinePrefix: 'Celebrating the 4th —',
  },
  {
    occasion: 'back_to_school',
    from: [7, 20],
    to: [8, 5],
    accent: 'accent-amber',
    headlinePrefix: 'Back-to-school season —',
  },
  {
    occasion: 'halloween',
    from: [9, 25],
    to: [9, 31],
    accent: 'accent-pumpkin',
    headlinePrefix: 'This Halloween —',
  },
  {
    occasion: 'thanksgiving',
    from: [10, 20],
    to: [10, 28],
    accent: 'accent-amber',
    headlinePrefix: 'Grateful this season —',
  },
  {
    occasion: 'holidays',
    from: [11, 10],
    to: [11, 28],
    accent: 'accent-evergreen',
    headlinePrefix: 'Happy holidays —',
  },
];

/** Is (month0, day) within [from..to] inclusive (same-year window)? */
function inWindow(month0: number, day: number, w: OccWindow): boolean {
  const v = month0 * 100 + day;
  return v >= w.from[0] * 100 + w.from[1] && v <= w.to[0] * 100 + w.to[1];
}

/**
 * Resolve the seasonal hero directive for a moment in time.
 *
 * @param nowMs - Epoch ms (injected for determinism).
 * @param opts - `hemisphere` (default 'north'); `occasions` (default true) — set
 *   false to suppress occasion theming and only return the season tint.
 * @returns A {@link SeasonalHero}. `occasion` is null outside every window.
 *
 * @example
 * ```ts
 * seasonalHero(Date.parse('2026-10-29T12:00:00Z'));
 * // { season:'autumn', occasion:'halloween', accent:'accent-pumpkin', headlinePrefix:'This Halloween —' }
 * ```
 */
export function seasonalHero(
  nowMs: number,
  opts: { hemisphere?: Hemisphere; occasions?: boolean } = {},
): SeasonalHero {
  const hemisphere = opts.hemisphere ?? 'north';
  const allowOccasions = opts.occasions ?? true;
  const d = new Date(nowMs);
  const month0 = d.getUTCMonth();
  const day = d.getUTCDate();
  const season = seasonForMonth(month0, hemisphere);

  if (allowOccasions && hemisphere === 'north') {
    const win = OCCASIONS.find((w) => inWindow(month0, day, w));
    if (win) {
      return {
        season,
        occasion: win.occasion,
        accent: win.accent,
        headlinePrefix: win.headlinePrefix,
      };
    }
  }
  return { season, occasion: null, accent: ACCENT_BY_SEASON[season], headlinePrefix: null };
}
