/**
 * @module ui
 * Spartan UI (helm) primitive barrel. Components import from `../../ui` rather
 * than per-file paths. Grows as the kit lands. The Tooltip primitive is LIVE on
 * the legacy admin topbar; the rest are the foundation per
 * [[spartan-ui-design-system]].
 */
export { cn } from './cn';
export { HlmButtonDirective, buttonVariants, type ButtonVariant, type ButtonSize } from './button';
export { HlmCardDirective, HlmCardTitleDirective, HlmCardDescriptionDirective } from './card';
export { HlmInputDirective } from './input';
export { HlmCheckboxDirective } from './checkbox';
export { HlmBadgeDirective, badgeVariants, type BadgeVariant } from './badge';
// Tooltip: only the styling provider is barrel-safe. Import the brain directive
// `BrnTooltipImports` DIRECTLY from '@spartan-ng/brain/tooltip' in components
// (re-exporting a brain directive breaks Angular AOT resolution — see tooltip.ts).
export { provideHlmTooltip } from './tooltip';
