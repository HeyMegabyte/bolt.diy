/**
 * @module services/template_branding
 * @description LM22 — pure mapper from per-site brand data (logo + colors extracted
 * from `_brand.json`) to transactional email template variables. Zero-I/O, deterministic,
 * never throws on missing data. The SES/Listmonk send path consumes these variables
 * so every transactional email (magic link, build notice, invoice) reflects the
 * business's brand, not the generic Projectsites palette.
 *
 * @packageDocumentation
 */

/** Per-site brand color palette. All values hex strings (e.g. '#7C3AED'). */
export interface BrandColors {
  /** Primary brand color (used for CTA buttons). */
  readonly primary: string;
  /** Accent brand color (used for links, highlights). */
  readonly accent?: string;
  /** Email background color (default '#0a0a1a'). */
  readonly background?: string;
  /** Email text color (default '#ffffff'). */
  readonly text?: string;
}

/** Template variables the email renderer consumes for one business. */
export interface BrandTemplateVars {
  /** Absolute URL to the brand logo, or null when none is available. */
  readonly logoUrl: string | null;
  /** Primary brand color hex. */
  readonly primaryColor: string;
  /** Accent brand color hex. */
  readonly accentColor: string;
  /** Email background color hex. */
  readonly backgroundColor: string;
  /** Email text color hex. */
  readonly textColor: string;
  /** Display name of the business. */
  readonly businessName: string;
  /** Rendered CSS custom-property block with brand colors (for the email <head>). */
  readonly cssVars: string;
  /** Inline `style` attribute string for a brand-colored CTA button. */
  readonly ctaStyle: string;
  /** Logo `<img>` tag string, or empty string when no logo is available. */
  readonly logoHtml: string;
}

/** Default palette is the Projectsites brand. */
const DEFAULT_COLORS: BrandColors = {
  accent: '#00E5FF',
  background: '#0a0a1a',
  primary: '#7C3AED',
  text: '#ffffff',
} as const;

/** CTA padding in each direction. */
const CTA_PADDING = '12px 24px';
/** CTA border radius. */
const CTA_RADIUS = '6px';

/**
 * Sum the sRGB bytes of a hex color to gauge luminance.
 *
 * @param hex - A 7-character hex color (e.g. '#7C3AED').
 * @returns The sum of the red, green, and blue byte values (0–765).
 *
 * @example
 * rgbSum('#ffffff');
 * // → 765
 *
 * @example
 * rgbSum('#000000');
 * // → 0
 */
function rgbSum(hex: string): number {
  const raw = hex.replace('#', '');
  if (raw.length < 6) return 0;
  const r = Number.parseInt(raw.substring(0, 2), 16);
  const g = Number.parseInt(raw.substring(2, 4), 16);
  const b = Number.parseInt(raw.substring(4, 6), 16);
  return r + g + b;
}

/**
 * Derive a brand CSS custom-property block from brand colors (used in email <head>).
 *
 * @param colors - The brand color palette.
 * @returns A `<style>` block string with `--brand-*` custom properties.
 *
 * @example
 * brandCss({ primary: '#7C3AED', accent: '#00E5FF', background: '#0a0a1a', text: '#ffffff' });
 * // → '  <style>:root{--brand-primary:#7C3AED;--brand-accent:#00E5FF;--brand-bg:#0a0a1a;--brand-text:#ffffff}</style>'
 */
export function brandCss(colors: BrandColors): string {
  const p = colors.primary;
  const a = colors.accent ?? DEFAULT_COLORS.accent!;
  const b = colors.background ?? DEFAULT_COLORS.background!;
  const t = colors.text ?? DEFAULT_COLORS.text!;
  return `  <style>:root{--brand-primary:${p};--brand-accent:${a};--brand-bg:${b};--brand-text:${t}}</style>`;
}

/**
 * Build a logo `<img>` tag, or empty string when `logoUrl` is falsy.
 *
 * @param logoUrl - Absolute URL to the brand logo, or null/undefined.
 * @param businessName - Business display name (used as alt text).
 * @returns An `<img>` tag string with alt text and a 40px max-height constraint,
 * or empty string when no logo is available.
 *
 * @example
 * logoImg('https://example.com/logo.png', 'Acme Inc');
 * // → '<img src="https://example.com/logo.png" alt="Acme Inc logo" style="max-height:40px">'
 *
 * @example
 * logoImg(null, 'Acme Inc');
 * // → ''
 */
export function logoImg(logoUrl: string | null | undefined, businessName: string): string {
  if (!logoUrl) return '';
  const safeAlt = businessName.replace(/["<>]/g, '');
  return `<img src="${logoUrl}" alt="${safeAlt} logo" style="max-height:40px">`;
}

/**
 * Build the full template-variable bag from brand data. Never throws on missing data;
 * absent fields merge with the Projectsites default palette.
 *
 * @param input - Brand data bag.
 * @param input.businessName - Display name of the business (required).
 * @param input.logoUrl - Absolute URL to the brand logo, or null/undefined.
 * @param input.colors - Optional brand color palette (any missing field falls back
 * to the Projectsites default).
 * @returns The {@link BrandTemplateVars} bag ready for email rendering.
 *
 * @example
 * buildTemplateVars({
 *   businessName: 'Acme Inc',
 *   logoUrl: 'https://example.com/logo.png',
 *   colors: { primary: '#7C3AED', accent: '#00E5FF' },
 * });
 * // → { logoUrl: 'https://example.com/logo.png', primaryColor: '#7C3AED', … }
 *
 * @example
 * buildTemplateVars({ businessName: 'Acme Inc' });
 * // → { logoUrl: null, primaryColor: '#7C3AED', accentColor: '#00E5FF',
 * //      backgroundColor: '#0a0a1a', textColor: '#ffffff', businessName: 'Acme Inc', … }
 */
export function buildTemplateVars(input: {
  businessName: string;
  logoUrl?: string | null;
  colors?: BrandColors | null;
}): BrandTemplateVars {
  const { businessName } = input;
  const logoUrl = input.logoUrl || null;
  const c = input.colors;
  const primaryColor = c?.primary ?? DEFAULT_COLORS.primary;
  const accentColor = c?.accent ?? DEFAULT_COLORS.accent!;
  const backgroundColor = c?.background ?? DEFAULT_COLORS.background!;
  const textColor = c?.text ?? DEFAULT_COLORS.text!;

  const safeColors: BrandColors = {
    accent: accentColor,
    background: backgroundColor,
    primary: primaryColor,
    text: textColor,
  };

  const cssVars = brandCss(safeColors);
  const logoHtml = logoImg(logoUrl, businessName);

  // Contrast check: when the primary is light (RGB sum > 500), use dark text.
  const ctaTextColor = rgbSum(primaryColor) > 500 ? '#0a0a1a' : textColor;
  const ctaStyle = [
    `background:${primaryColor}`,
    `color:${ctaTextColor}`,
    `padding:${CTA_PADDING}`,
    `border-radius:${CTA_RADIUS}`,
    'text-decoration:none',
    'font-weight:600',
    'display:inline-block',
  ].join(';');

  return {
    accentColor,
    backgroundColor,
    businessName,
    cssVars,
    ctaStyle,
    logoHtml,
    logoUrl: logoUrl,
    primaryColor,
    textColor,
  };
}
