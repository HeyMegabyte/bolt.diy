/**
 * @module ui/badge
 * Spartan-style helm Badge directive (`hlmBadge`) — status pills for tables +
 * cards (site status, flag stage, delivery state). Color-blind-safe: pairs
 * color with the label text. Part of the Spartan UI layer per
 * [[spartan-ui-design-system]].
 *
 * @example `<span hlmBadge variant="success">Published</span>`
 */
import { Directive, computed, input } from '@angular/core';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

export const badgeVariants = cva(
  'inline-flex items-center rounded px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-wider border',
  {
    variants: {
      variant: {
        neutral: 'border-border text-muted-foreground',
        info: 'border-border text-primary',
        success: 'border-border text-[#4dffb5]',
        warning: 'border-border text-[#ffd166]',
        danger: 'border-border text-destructive',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

@Directive({
  selector: '[hlmBadge]',
  standalone: true,
  host: { '[class]': 'computedClass()' },
})
export class HlmBadgeDirective {
  readonly variant = input<BadgeVariant>('neutral');
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly computedClass = computed(() =>
    cn(badgeVariants({ variant: this.variant() }), this.userClass()),
  );
}
