/**
 * @module ui/card
 * Spartan-style helm Card primitives (`hlmCard`, `hlmCardTitle`, `hlmCardDescription`).
 * Cockpit-tokened container surfaces. Part of the Spartan UI layer (Wave C)
 * per [[spartan-ui-design-system]].
 *
 * @example
 * ```html
 * <div hlmCard>
 *   <h3 hlmCardTitle>Acme Bakery</h3>
 *   <p hlmCardDescription>Published · Lighthouse 96</p>
 * </div>
 * ```
 */
import { Directive, computed, input } from '@angular/core';
import { cn } from './cn';

@Directive({
  selector: '[hlmCard]',
  standalone: true,
  host: { '[class]': 'computedClass()' },
})
export class HlmCardDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly computedClass = computed(() =>
    cn(
      'block rounded-xl border border-border bg-card text-card-foreground p-4',
      // Layered depth + a faint inner top sheen (subtle glass) for a premium feel.
      'shadow-[0_1px_2px_rgba(0,0,0,0.4),0_10px_28px_-18px_rgba(0,0,0,0.7)] ring-1 ring-inset ring-white/[0.02]',
      // Gentle cyan-tinted lift on hover (decorative; doesn't imply clickability).
      'transition-[border-color,box-shadow] duration-200 hover:border-ring/40 hover:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_12px_32px_-14px_rgba(0,229,255,0.14)]',
      this.userClass(),
    ),
  );
}

@Directive({
  selector: '[hlmCardTitle]',
  standalone: true,
  host: { '[class]': 'computedClass()' },
})
export class HlmCardTitleDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly computedClass = computed(() =>
    cn('text-sm font-semibold tracking-tight text-foreground', this.userClass()),
  );
}

@Directive({
  selector: '[hlmCardDescription]',
  standalone: true,
  host: { '[class]': 'computedClass()' },
})
export class HlmCardDescriptionDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly computedClass = computed(() =>
    cn('text-xs text-muted-foreground', this.userClass()),
  );
}
