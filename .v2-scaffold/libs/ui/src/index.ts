/**
 * `@org/ui` — design system entry. Theme tokens land first; UI
 * primitives + components plug in under `./lib/` as they're built.
 */
export * from './theme/extracted-tokens.js';
export {
  ensureContrast,
  ensureContrastLarge,
  getContrastRatio,
  parseColor,
  relativeLuminance,
  rgbToOklch,
  oklchToRgb,
} from './theme/wcag-color-adjuster.js';
export type { OKLCH, RGB } from './theme/wcag-color-adjuster.js';

// Lib components — surfaced from `./lib/`.
export {
  VideoWithCaptionsComponent,
  type TranscribeResult,
} from './lib/video-with-captions/video-with-captions.component.js';
export {
  ColorBlindFilterComponent,
  COLOR_BLIND_MATRICES,
  type ColorBlindMode,
} from './lib/color-blind-filter/color-blind-filter.component.js';
