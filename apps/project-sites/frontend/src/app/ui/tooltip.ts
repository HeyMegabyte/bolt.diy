/**
 * @module ui/tooltip
 * Spartan-style helm Tooltip — a thin cockpit layer over the `@spartan-ng/brain`
 * tooltip primitive. Apply `[brnTooltip]="'text'"` to any element; the
 * {@link provideHlmTooltip} provider styles every tooltip with the dark+cyan
 * cockpit surface (no per-usage classes needed). Brain handles the CDK overlay,
 * viewport-aware flipping, hover/focus triggers, and `aria-describedby` wiring.
 *
 * Activates the dormant Spartan UI layer (`src/app/ui/*`) on the real admin per
 * [[spartan-ui-design-system]] + [[spartan-ui-only]] — additive, no layout churn.
 *
 * @example
 * ```ts
 * // component:
 * imports: [...HlmTooltipImports], providers: [provideHlmTooltip()]
 * // template:
 * <button [brnTooltip]="'Open command palette'" aria-label="Command palette">…</button>
 * ```
 */
import type { ValueProvider } from '@angular/core';
import { provideBrnTooltipDefaultOptions } from '@spartan-ng/brain/tooltip';

// NOTE: import the brain DIRECTIVE (`BrnTooltipImports`) DIRECTLY from
// '@spartan-ng/brain/tooltip' in the consuming component's `imports: [...]`.
// Re-exporting it through this barrel makes the Angular AOT compiler resolve
// the directive to its `.d.ts` (no runtime sibling) and the esbuild build
// fails ("Could not resolve …/tooltip/index"). Only non-directive helpers
// (this provider) are safe to re-export. The provider styles every tooltip;
// the directive is applied as `[brnTooltip]="'text'"`.

/**
 * Cockpit-styled defaults for every brain tooltip in the providing scope:
 * dark surface (`#0b171d`), cyan hairline, compact type, above the overlay
 * stack. Add to a component/app `providers: [provideHlmTooltip()]`.
 */
export function provideHlmTooltip(): ValueProvider {
  return provideBrnTooltipDefaultOptions({
    showDelay: 200,
    hideDelay: 80,
    position: 'top',
    tooltipContentClasses:
      'rounded-md bg-[#0b171d] text-[#e8fbff] border border-[rgba(0,229,255,0.22)] ' +
      'px-2.5 py-1.5 text-xs font-medium shadow-[0_8px_24px_rgba(0,0,0,0.5)] z-[100001]',
    arrowClasses: () => 'bg-[#0b171d] border-l border-t border-[rgba(0,229,255,0.22)]',
    svgClasses: 'fill-[#0b171d]',
  });
}
