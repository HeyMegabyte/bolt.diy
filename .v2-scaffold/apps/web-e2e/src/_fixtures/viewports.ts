/**
 * Standard 6-breakpoint viewport presets used across the Phase-7 suite.
 *
 * @remarks
 * These match the `playwright.config.ts` project matrix and the
 * 6bp contract from `[[e2e-tdd-organization]]`.
 */

export interface ViewportPreset {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export const VIEWPORTS: readonly ViewportPreset[] = [
  { name: 'xs', width: 375, height: 667 },
  { name: 'sm', width: 768, height: 1024 },
  { name: 'md', width: 1024, height: 768 },
  { name: 'lg', width: 1280, height: 800 },
  { name: 'xl', width: 1920, height: 1080 },
  /** Mobile-first for Safari / iOS viewport quirks */
  { name: 'mobile', width: 390, height: 844 },
] as const;

/** Single default desktop viewport for specs that don't need full matrix coverage. */
export const DEFAULT_VIEWPORT: ViewportPreset = { name: 'lg', width: 1280, height: 800 };
