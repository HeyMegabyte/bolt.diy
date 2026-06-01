/**
 * @module ui/select
 * Spartan-style helm Select directive (`hlmSelect`). Applied to a native
 * `<select>`, it gives the cockpit chrome (bg-card, border, focus-visible ring,
 * 36px height to match hlmInput) + a cyan chevron, while keeping the native
 * control so `[(ngModel)]` / `(change)` / `<option>` all work unchanged.
 * Barrel-safe (own directive, no brain-AOT gotcha). Part of the Spartan UI
 * layer per [[spartan-ui-design-system]].
 *
 * @example `<select hlmSelect [(ngModel)]="tz"><option>…</option></select>`
 */
import { Directive, computed, input } from '@angular/core';
import { cn } from './cn';

// Inline cyan chevron (native <select> can't use ::after). Encoded SVG so it
// ships in the class without an asset request; appearance:none hides the OS one.
const CHEVRON =
  "[background-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2300e5ff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")]";

@Directive({
  selector: 'select[hlmSelect]',
  standalone: true,
  host: { '[class]': 'computedClass()' },
})
export class HlmSelectDirective {
  readonly error = input(false);
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly computedClass = computed(() =>
    cn(
      'flex h-9 w-full appearance-none rounded-lg border bg-card pl-3 pr-9 py-1 text-sm text-foreground',
      'cursor-pointer transition-colors',
      'bg-[position:right_0.6rem_center] bg-[size:16px] bg-no-repeat',
      CHEVRON,
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:cursor-not-allowed disabled:opacity-50',
      this.error() ? 'border-destructive' : 'border-input',
      this.userClass(),
    ),
  );
}
