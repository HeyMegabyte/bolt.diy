/**
 * Captured design tokens — the v2 single source of truth.
 *
 * Pulled from the v1 Angular 21 frontend (tailwind.config.ts +
 * `_polish.scss` + `_admin-polish.scss`) on 2026-05-26. OKLCH values
 * are 3-decimal sRGB→OKLCH conversions; round-trip via `culori` in
 * Phase 2 to verify.
 *
 * @remarks AUDIT.md §4.1 — the brand tokens existed only as `var()`
 * fallbacks in source. This file is the explicit declaration; the
 * accompanying `css-vars.scss` materialises them onto `:root`.
 *
 * @see AUDIT.md §4 for the full extraction methodology
 */

export interface TokenColor {
  readonly hex?: string;
  readonly oklch?: string;
  readonly rgba?: string;
}

export const theme = {
  colors: {
    // Brand — dark-first
    bg: { hex: '#060610', oklch: 'oklch(0.118 0.018 277)' } as const,
    ink: { hex: '#f4f4ff', oklch: 'oklch(0.969 0.013 282)' } as const,
    accent: { hex: '#00E5FF', oklch: 'oklch(0.857 0.140 213)' } as const,
    accentSecondary: { hex: '#7C3AED', oklch: 'oklch(0.516 0.260 287)' } as const,

    // Legacy Tailwind aliases — kept until full migration
    primary: { hex: '#00E5FF', oklch: 'oklch(0.857 0.140 213)' } as const,
    primaryDim: { rgba: 'rgba(0, 229, 255, 0.12)' } as const,
    secondary: { hex: '#50AAE3', oklch: 'oklch(0.690 0.121 240)' } as const,
    darkCard: { hex: '#0c0c1e', oklch: 'oklch(0.157 0.038 282)' } as const,
    darkSurface: { hex: '#111128', oklch: 'oklch(0.181 0.044 282)' } as const,
    light: { hex: '#f0f0f8', oklch: 'oklch(0.951 0.011 282)' } as const,
    textSecondary: { hex: '#94a3b8', oklch: 'oklch(0.677 0.036 251)' } as const,

    // Dark-first surface stack
    surface1: { rgba: 'rgba(13, 13, 40, 0.85)' } as const,
    surface2: { rgba: 'rgba(10, 10, 30, 0.97)' } as const,
    surface3: { rgba: 'rgba(8, 8, 32, 0.98)' } as const,
    surfaceGlass: { rgba: 'rgba(13, 13, 40, 0.62)' } as const,

    // Derived (color-mix in oklch)
    accentGlow: 'color-mix(in oklch, var(--ps-accent) 35%, transparent)',
    accentSoft: 'color-mix(in oklch, var(--ps-accent) 14%, transparent)',
    accentLine: 'color-mix(in oklch, var(--ps-accent) 28%, transparent)',
    elev1: 'color-mix(in oklch, var(--ps-bg) 92%, var(--ps-ink) 8%)',
    elev2: 'color-mix(in oklch, var(--ps-bg) 85%, var(--ps-ink) 15%)',
    elev3: 'color-mix(in oklch, var(--ps-bg) 78%, var(--ps-ink) 22%)',
    hairline: 'color-mix(in oklch, var(--ps-ink) 8%, transparent)',
    hairlineHi: 'color-mix(in oklch, var(--ps-ink) 14%, transparent)',
  },

  font: {
    sans: ['Sora', 'system-ui', 'sans-serif'] as const,
    heading: ['Space Grotesk', 'system-ui', 'sans-serif'] as const,
    mono: ['JetBrains Mono', 'ui-monospace', 'monospace'] as const,
  },

  // Fluid clamp() scale — recovered from inline component sizing.
  // Phase 2 to validate against rendered specimens.
  fontSize: {
    xs: 'clamp(0.72rem, 0.7rem + 0.1vw, 0.78rem)',
    sm: 'clamp(0.82rem, 0.78rem + 0.2vw, 0.9rem)',
    base: 'clamp(0.95rem, 0.9rem + 0.25vw, 1rem)',
    lg: 'clamp(1.05rem, 1rem + 0.3vw, 1.15rem)',
    xl: 'clamp(1.2rem, 1.1rem + 0.5vw, 1.4rem)',
    '2xl': 'clamp(1.5rem, 1.3rem + 1vw, 2rem)',
    '3xl': 'clamp(1.875rem, 1.5rem + 1.875vw, 3rem)',
    '4xl': 'clamp(2.25rem, 1.8rem + 2.25vw, 4rem)',
    '5xl': 'clamp(3rem, 2.4rem + 3vw, 5rem)',
    '6xl': 'clamp(3.75rem, 3rem + 3.75vw, 6rem)',
  },

  space: {
    0: '0',
    1: '0.25rem',
    2: '0.5rem',
    3: '0.75rem',
    4: '1rem',
    5: '1.25rem',
    6: '1.5rem',
    8: '2rem',
    10: '2.5rem',
    12: '3rem',
    16: '4rem',
    20: '5rem',
    24: '6rem',
  },

  radii: {
    xs: '6px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '22px',
  },

  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.18)',
    md: '0 6px 18px -8px rgba(0, 0, 0, 0.42)',
    lg: '0 16px 40px -16px rgba(0, 0, 0, 0.55)',
    xl: '0 24px 64px -16px rgba(0, 0, 0, 0.7)',
    card: '0 6px 18px -8px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.04) inset',
    modal: '0 24px 64px rgba(0, 0, 0, 0.55), 0 0 80px rgba(0, 229, 255, 0.04)',
  },

  motion: {
    duration: {
      fast: '140ms',
      base: '220ms',
      slow: '380ms',
    },
    easing: {
      in: 'cubic-bezier(0.4, 0, 1, 1)',
      out: 'cubic-bezier(0, 0, 0.2, 1)',
      emphasized: 'cubic-bezier(0.16, 1, 0.3, 1)',
      spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    },
    keyframes: {
      fadeInUp: {
        '0%': { opacity: '0', transform: 'translateY(20px)' },
        '100%': { opacity: '1', transform: 'translateY(0)' },
      },
      glowPulse: {
        '0%, 100%': { boxShadow: '0 0 20px rgba(0,229,255,0.3)' },
        '50%': { boxShadow: '0 0 40px rgba(0,229,255,0.6)' },
      },
      shimmer: {
        '0%': { backgroundPosition: '-200% 0' },
        '100%': { backgroundPosition: '200% 0' },
      },
      float: {
        '0%, 100%': { transform: 'translateY(0)' },
        '50%': { transform: 'translateY(-10px)' },
      },
    },
  },

  zIndex: {
    dropdown: 1000,
    sticky: 1100,
    modalBackdrop: 1900,
    modal: 2000,
    sidePanel: 2050,
    popover: 99_950,
    banner: 10_000,
    toast: 9_999,
    /** 32-bit max — wins everything (last-resort overlay takeover). */
    overlayTakeover: 2_147_483_647,
  },

  density: {
    comfortable: {
      cardPad: '1.4rem',
      rowPad: '0.5rem',
      gap: '0.95rem',
      fontBase: '0.78rem',
    },
    compact: {
      cardPad: '0.95rem',
      rowPad: '0.3rem',
      gap: '0.55rem',
      fontBase: '0.72rem',
    },
    spacious: {
      cardPad: '1.85rem',
      rowPad: '0.75rem',
      gap: '1.4rem',
      fontBase: '0.85rem',
    },
  },

  focus: {
    /** Note: brand-divergent. Phase 2 should consolidate to --ps-accent unless Brian wants a distinct focus hue. */
    ring: '2px solid #00ffc8',
    ringOffset: '2px',
  },

  light: {
    bg: { hex: '#f7f7fc', oklch: 'oklch(0.978 0.005 282)' } as const,
    ink: { hex: '#060610', oklch: 'oklch(0.118 0.018 277)' } as const,
    surface1: 'rgba(255, 255, 255, 0.92)',
    surface2: 'rgba(250, 250, 252, 0.97)',
    surface3: 'rgba(244, 244, 248, 0.98)',
    surfaceGlass: 'rgba(255, 255, 255, 0.72)',
  },

  reducedMotion: {
    durationFast: '1ms',
    durationBase: '1ms',
    durationSlow: '1ms',
  },
} as const;

export type Theme = typeof theme;
