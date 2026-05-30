/**
 * @module ui/cn
 *
 * `cn()` — the canonical class-name merge helper for the Spartan UI (helm)
 * component layer. Combines `clsx` (conditional class composition) with
 * `tailwind-merge` (last-wins conflict resolution across Tailwind utilities)
 * so component variants + caller overrides compose without specificity wars.
 *
 * Every helm component in `src/app/ui/*` uses this. Foundation for the Spartan
 * rebuild (Wave C) per [[spartan-ui-design-system]] + the dashboard package
 * integration map.
 *
 * @example
 * ```ts
 * cn('px-3 py-2', isActive && 'bg-primary text-dark', extraClass)
 * // → conflicting paddings/colors resolved last-wins
 * ```
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional + Tailwind class names with last-wins conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
