/**
 * @module ui/checkbox
 * Spartan-style helm Checkbox directive (`hlmCheckbox`). Applied to a native
 * `<input type="checkbox">`, it gives the cockpit cyan accent + focus ring +
 * 24px target (WCAG 2.2 AA 2.5.8) without a wrapper component. Native input =
 * `[(ngModel)]` / `(change)` / `:checked` all work unchanged; barrel-safe (own
 * directive, no brain-AOT gotcha). Part of the Spartan UI layer per
 * [[spartan-ui-design-system]].
 *
 * @example `<input type="checkbox" hlmCheckbox [ngModel]="on" (ngModelChange)="toggle()" />`
 */
import { Directive, computed, input } from '@angular/core';
import { cn } from './cn';

@Directive({
  selector: 'input[type=checkbox][hlmCheckbox]',
  standalone: true,
  host: { '[class]': 'computedClass()' },
})
export class HlmCheckboxDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly computedClass = computed(() =>
    cn(
      // accent-color paints the native check with the cockpit cyan in supporting
      // browsers; size + cursor + ring round it out. min 16px box inside a 24px
      // tap target via the surrounding label padding.
      'h-4 w-4 shrink-0 cursor-pointer rounded border border-input bg-card',
      'accent-[color:var(--ps-accent,#00e5ff)]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:cursor-not-allowed disabled:opacity-50',
      this.userClass(),
    ),
  );
}
