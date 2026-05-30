/**
 * @module ui/input
 * Spartan-style helm Input directive (`hlmInput`). Applied to native
 * `<input>`/`<textarea>`/`<select>`; cockpit-tokened, focus-ring, used by
 * Wave-D Formly+Zod forms. Part of the Spartan UI layer per
 * [[spartan-ui-design-system]].
 *
 * @example `<input hlmInput placeholder="Slug" />`
 */
import { Directive, computed, input } from '@angular/core';
import { cn } from './cn';

@Directive({
  selector: '[hlmInput]',
  standalone: true,
  host: { '[class]': 'computedClass()' },
})
export class HlmInputDirective {
  readonly error = input(false);
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly computedClass = computed(() =>
    cn(
      'flex h-9 w-full rounded-lg border bg-card px-3 py-1 text-sm text-foreground',
      'placeholder:text-muted-foreground transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:cursor-not-allowed disabled:opacity-50',
      this.error() ? 'border-destructive' : 'border-input',
      this.userClass(),
    ),
  );
}
