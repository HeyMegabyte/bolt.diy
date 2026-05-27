/**
 * WCAG 2.2 color auto-adjuster — given a foreground + background pair,
 * lift or darken the foreground until its contrast ratio against the
 * background clears the AA threshold (4.5:1 normal, 3:1 large text).
 *
 * @remarks
 *  All math runs in linear sRGB (per WCAG relative-luminance spec). The
 *  adjuster nudges OKLCH lightness in 4% steps, choosing the direction
 *  that moves AWAY from the background's luminance. Caps at ±64 steps
 *  (≈ ±2.56 L delta) — past that point we surrender with the closest
 *  passing color, never throw, never block render.
 *
 *  Pair with palette extraction (`color-thief`, `extracted-tokens.ts`)
 *  so any tenant-supplied accent is silently lifted into a contrast-safe
 *  variant before it lands on dark or light surfaces.
 *
 * @example
 *   const safeAccent = ensureContrast('#1e3a8a', '#060610', 4.5);
 *   // '#5d8cf8' (lifted lightness; same hue + chroma family)
 *
 * @see [[text-contrast]]
 */

/** Parse any CSS color (`#hex`, `rgb()`, `oklch()`, `color-mix()`) into RGB 0-255. */
export interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** OKLCH triple — L 0-1, C 0-0.4-ish, H 0-360. */
export interface OKLCH {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FN = /^rgba?\(\s*([+-]?\d*\.?\d+)\s*,?\s*([+-]?\d*\.?\d+)\s*,?\s*([+-]?\d*\.?\d+)/i;

/** Best-effort string-to-RGB. Returns null for unparseable inputs. */
export function parseColor(input: string): RGB | null {
  const v = input.trim();
  const short = HEX_SHORT.exec(v);
  if (short && short[1] && short[2] && short[3]) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }
  const long = HEX_LONG.exec(v);
  if (long && long[1] && long[2] && long[3]) {
    return {
      r: parseInt(long[1], 16),
      g: parseInt(long[2], 16),
      b: parseInt(long[3], 16),
    };
  }
  const rgb = RGB_FN.exec(v);
  if (rgb && rgb[1] && rgb[2] && rgb[3]) {
    return {
      r: clamp255(Number(rgb[1])),
      g: clamp255(Number(rgb[2])),
      b: clamp255(Number(rgb[3])),
    };
  }
  return null;
}

function clamp255(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** sRGB component (0-1) → linear-light. WCAG 2.2 G18 reference. */
function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** linear-light → sRGB component (0-1). */
function linearToSrgb(c: number): number {
  return c <= 0.00304 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** WCAG relative luminance for an RGB triple. */
export function relativeLuminance({ r, g, b }: RGB): number {
  const rl = srgbToLinear(r / 255);
  const gl = srgbToLinear(g / 255);
  const bl = srgbToLinear(b / 255);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG contrast ratio between two CSS colors. Falls back to 1 for unparseable input. */
export function getContrastRatio(c1: string, c2: string): number {
  const a = parseColor(c1);
  const b = parseColor(c2);
  if (!a || !b) return 1;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// --- OKLCH conversion (Björn Ottosson, "A perceptual color space for image processing").
// Matrices reproduced verbatim so the bundle stays one file.

function linearSrgbToOklab(r: number, g: number, b: number): { l: number; a: number; b: number } {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    l: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklabToLinearSrgb(l: number, a: number, b: number): { r: number; g: number; b: number } {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const lc = l_ ** 3;
  const mc = m_ ** 3;
  const sc = s_ ** 3;
  return {
    r: 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    g: -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    b: -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  };
}

/** Convert an RGB 0-255 triple to OKLCH. */
export function rgbToOklch(rgb: RGB): OKLCH {
  const r = srgbToLinear(rgb.r / 255);
  const g = srgbToLinear(rgb.g / 255);
  const b = srgbToLinear(rgb.b / 255);
  const { l, a, b: bb } = linearSrgbToOklab(r, g, b);
  const c = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l, c, h };
}

/** Convert OKLCH back to an RGB 0-255 triple, gamut-clipped. */
export function oklchToRgb(oklch: OKLCH): RGB {
  const hr = (oklch.h * Math.PI) / 180;
  const a = oklch.c * Math.cos(hr);
  const b = oklch.c * Math.sin(hr);
  const lin = oklabToLinearSrgb(oklch.l, a, b);
  return {
    r: clamp255(linearToSrgb(clamp01(lin.r)) * 255),
    g: clamp255(linearToSrgb(clamp01(lin.g)) * 255),
    b: clamp255(linearToSrgb(clamp01(lin.b)) * 255),
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Ensure the foreground hits `minRatio` against the background by nudging
 * its OKLCH lightness in 4% steps. Direction is chosen against the
 * background's luminance: dark bg → push fg lighter, light bg → push
 * darker. Caps at 64 iterations; returns the best result reached.
 *
 * @param fg - Any CSS color the parser handles (`#hex`, `rgb()`).
 * @param bg - Same.
 * @param minRatio - WCAG ratio floor. Defaults to 4.5 (AA body text).
 * @returns A hex string that meets the threshold OR the closest reached.
 */
export function ensureContrast(fg: string, bg: string, minRatio = 4.5): string {
  const fgRgb = parseColor(fg);
  const bgRgb = parseColor(bg);
  if (!fgRgb || !bgRgb) return fg;

  const current = getContrastRatio(fg, bg);
  if (current >= minRatio) return rgbToHex(fgRgb);

  const bgLum = relativeLuminance(bgRgb);
  const lightenWhenDarkBg = bgLum < 0.5;
  const step = 0.04;
  const fgOklch = rgbToOklch(fgRgb);

  let best: RGB = fgRgb;
  let bestRatio = current;

  for (let i = 1; i <= 64; i++) {
    const nextL = lightenWhenDarkBg
      ? Math.min(0.99, fgOklch.l + step * i)
      : Math.max(0.01, fgOklch.l - step * i);
    const candidate: OKLCH = { l: nextL, c: fgOklch.c, h: fgOklch.h };
    const candRgb = oklchToRgb(candidate);
    const ratio = getContrastRatio(rgbToHex(candRgb), bg);
    if (ratio > bestRatio) {
      best = candRgb;
      bestRatio = ratio;
    }
    if (ratio >= minRatio) return rgbToHex(candRgb);
    if (lightenWhenDarkBg && nextL >= 0.99) break;
    if (!lightenWhenDarkBg && nextL <= 0.01) break;
  }
  return rgbToHex(best);
}

/**
 * Convenience: ensure AA-large (3:1) — bigger headings, badge numerals.
 */
export function ensureContrastLarge(fg: string, bg: string): string {
  return ensureContrast(fg, bg, 3);
}
