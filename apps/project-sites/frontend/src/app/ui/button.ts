/**
 * @module ui/button
 * Spartan-style helm Button directive (`hlmBtn`). Applied to a native
 * `<button>`/`<a>`, it composes cva variants + the cockpit helm tokens via
 * {@link cn}. First primitive of the Spartan UI layer (Wave C) per
 * [[spartan-ui-design-system]].
 *
 * @example `<button hlmBtn variant="primary" size="sm">Save</button>`
 */
import { Directive, computed, input } from '@angular/core';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ' +
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none ' +
    'disabled:opacity-50 cursor-pointer select-none',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:brightness-110 shadow-[0_0_18px_rgba(0,229,255,0.18)]',
        secondary: 'bg-card text-foreground border border-border hover:bg-accent',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
        outline: 'border border-border bg-transparent text-foreground hover:bg-accent',
        destructive: 'bg-destructive text-destructive-foreground hover:brightness-110',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

@Directive({
  selector: '[hlmBtn]',
  standalone: true,
  host: { '[class]': 'computedClass()' },
})
export class HlmButtonDirective {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly computedClass = computed(() =>
    cn(buttonVariants({ variant: this.variant(), size: this.size() }), this.userClass()),
  );
}
