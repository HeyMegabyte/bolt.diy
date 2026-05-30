/**
 * @module ui
 * Spartan UI (helm) primitive barrel for the v2 dashboard. Wave-D+ feature
 * components import everything from `../../ui` rather than per-file paths.
 * Grows as the kit lands (Dialog/Sheet/Select/Tabs/Command next).
 * Foundation per [[spartan-ui-design-system]].
 */
export { cn } from './cn';
export { HlmButtonDirective, buttonVariants, type ButtonVariant, type ButtonSize } from './button';
export { HlmCardDirective, HlmCardTitleDirective, HlmCardDescriptionDirective } from './card';
export { HlmInputDirective } from './input';
export { HlmBadgeDirective, badgeVariants, type BadgeVariant } from './badge';
