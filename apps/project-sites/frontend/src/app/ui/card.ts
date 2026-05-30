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
      'shadow-[0_1px_2px_rgba(0,0,0,0.4)] transition-colors hover:border-ring/40',
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
