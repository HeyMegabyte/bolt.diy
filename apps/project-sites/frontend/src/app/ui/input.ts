/**
 * @module ui/input
 * Spartan-style helm Input directive (`hlmInput`). Applied to native
 * `<input>`/`<textarea>`/`<select>`; cockpit-tokened, focus-ring, used by
 * Wave-D Formly+Zod forms. Part of the Spartan UI layer per
 * [[spartan-ui-design-system]].
 *
 * @example `<input hlmInput placeholder="Slug" />`
 * @example seamless segment inside a composite field (wrapper owns the
 *   border/bg/focus), e.g. a `subdomain ▸ .projectsites.dev` combo:
 *   `<input hlmInput [seamless]="true" class="font-mono" />`
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
  /**
   * Borderless/transparent variant for inputs that live INSIDE a composite
   * wrapper that already paints the border, background, padding, and focus
   * affordance (e.g. an input + fixed suffix). Drops the box chrome (height,
   * border, bg, rounded, padding) and the ring so the field reads as one
   * seamless control. Keeps text + placeholder + disabled styling.
   */
  readonly seamless = input(false);
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly computedClass = computed(() =>
    this.seamless()
      ? cn(
          'flex w-full min-w-0 border-0 bg-transparent text-sm text-foreground',
          'placeholder:text-muted-foreground transition-colors',
          'focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          this.userClass(),
        )
      : cn(
          'flex h-9 w-full rounded-lg border bg-card px-3 py-1 text-sm text-foreground',
          'placeholder:text-muted-foreground transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          this.error() ? 'border-destructive' : 'border-input',
          this.userClass(),
        ),
  );
}
