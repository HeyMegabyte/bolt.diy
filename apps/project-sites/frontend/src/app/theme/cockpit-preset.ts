/**
 * cockpit-preset.ts — PrimeNG v20 theme preset matching the admin cockpit.
 *
 * The admin cockpit is a black + cyan "dev-cockpit" surface whose design
 * tokens live in `src/styles/_cockpit.scss` (scoped to `[data-cockpit="v2"]`,
 * brand: `--ps-bg:#060610`, `--ps-ink:#f4f4ff`, `--ps-accent:#00e5ff`).
 *
 * PrimeNG ships with the Aura preset whose default primary palette is BLUE.
 * Dropping raw PrimeNG into the cockpit would leak that blue everywhere
 * (buttons, focus rings, table sort arrows, toggles, links). This preset
 * overrides Aura so every PrimeNG component renders in the cockpit's
 * cyan-on-near-black aesthetic instead.
 *
 * Strategy:
 *  - `primary` ramp → the cockpit cyan ramp (50…950) so p-button, p-checkbox,
 *    p-radiobutton, p-toggleswitch, focus rings, active table rows, paginator
 *    highlights all render cyan.
 *  - dark-mode `colorScheme.dark.surface` → the cockpit near-black ramp so
 *    panels, table headers, dialog chrome, dropdown popups sit on #03070a…
 *  - The admin host is ALWAYS dark, so `darkModeSelector` targets the cockpit
 *    host attribute (`[data-cockpit="v2"]`). PrimeNG then applies the dark
 *    color-scheme tokens to every component rendered inside the admin subtree.
 *
 * @see src/styles/_cockpit.scss — the SSOT token layer this mirrors
 * @see src/app/app.config.ts — where this preset is wired via providePrimeNG
 */
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

/**
 * Cockpit cyan ramp. Mirrors the `--ck-cyan-*` ladder in `_cockpit.scss`,
 * resolved to concrete hexes (PrimeNG palette tokens must be static values,
 * not `var()` references, so the design-token engine can derive hover/active
 * shades). `500 = #00e5ff` is the hero accent (≈ oklch(0.84 0.16 200)).
 */
const cyan = {
  50: '#e6fdff',
  100: '#b3f7ff',
  200: '#80f0ff',
  300: '#4de9ff',
  400: '#26e7ff',
  500: '#00e5ff',
  600: '#00b8cc',
  700: '#008a99',
  800: '#005c66',
  900: '#002e33',
  950: '#001719',
};

/**
 * Cockpit near-black surface ramp. Mirrors `--ck-bg` (#03070a) plus the
 * white-opacity elevation steps (`--ck-surface-1/2/3`) resolved to opaque
 * hexes so PrimeNG's overlays/popups (which render on `cdk`-style portals
 * outside the cockpit subtree) still read black, not Aura's default zinc.
 */
const surface = {
  0: '#ffffff',
  50: '#e8fbff',
  100: '#b7cfd6',
  200: '#7aa7b3',
  300: '#4d7782',
  400: '#2f4d56',
  500: '#1c333a',
  600: '#13262b',
  700: '#0c1a1f',
  800: '#070f12',
  900: '#060610', // brand near-black (--ck-bg-alt)
  950: '#03070a', // deepest canvas (--ck-bg)
};

export const CockpitPreset = definePreset(Aura, {
  semantic: {
    primary: cyan,
    // Cockpit focus ring is a lifted low-chroma cyan (≥3:1) — keep PrimeNG's
    // focus visuals on-brand.
    focusRing: {
      width: '2px',
      style: 'solid',
      color: '{primary.400}',
      offset: '2px',
      shadow: 'none',
    },
    colorScheme: {
      dark: {
        // Cockpit is dark-only — map PrimeNG dark surfaces onto the cockpit
        // black ramp so panels/tables/dialogs/popups sit on the right canvas.
        surface,
        primary: {
          color: '{primary.500}',
          contrastColor: '#03070a', // dark text on cyan buttons — AA on #00e5ff
          hoverColor: '{primary.400}',
          activeColor: '{primary.600}',
        },
        highlight: {
          // Selected rows / active items — soft cyan tint (matches --ck-cyan-soft)
          background: 'color-mix(in oklch, #00e5ff 16%, transparent)',
          focusBackground: 'color-mix(in oklch, #00e5ff 24%, transparent)',
          color: '#e8fbff',
          focusColor: '#e8fbff',
        },
        content: {
          background: 'color-mix(in oklch, #ffffff 3%, #03070a)',
          hoverBackground: 'color-mix(in oklch, #ffffff 6%, #03070a)',
          borderColor: 'color-mix(in oklch, #00e5ff 22%, transparent)',
          color: '#e8fbff',
          hoverColor: '#e8fbff',
        },
        text: {
          color: '#e8fbff',
          hoverColor: '#ffffff',
          mutedColor: '#7aa7b3',
          hoverMutedColor: '#b7cfd6',
        },
        formField: {
          background: 'color-mix(in oklch, #ffffff 3%, #03070a)',
          disabledBackground: 'color-mix(in oklch, #ffffff 2%, #03070a)',
          filledBackground: 'color-mix(in oklch, #ffffff 6%, #03070a)',
          borderColor: 'color-mix(in oklch, #00e5ff 22%, transparent)',
          hoverBorderColor: 'color-mix(in oklch, #00e5ff 44%, transparent)',
          focusBorderColor: '{primary.400}',
          color: '#e8fbff',
          placeholderColor: '#7aa7b3',
          floatLabelColor: '#7aa7b3',
        },
      },
    },
  },
});
