import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostBinding,
  Input,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Rolling counter — counts up from 0 to `value` via requestAnimationFrame
 * with easeOutQuart easing. Locale-formats with `Intl.NumberFormat`.
 *
 * @remarks
 * - Fires only when the host enters the viewport (IntersectionObserver, 0.4).
 * - Respects `prefers-reduced-motion: reduce` → snaps to final value.
 * - `aria-live="off"` during the animation so screen readers aren't spammed.
 *   The host's `aria-label` always reflects the final formatted value so AT
 *   users hear the meaningful number on first focus.
 * - Server-render safe — snaps to final value when not in browser.
 *
 * @example
 * ```html
 * <app-rolling-counter [value]="1234" suffix="+" />
 * <app-rolling-counter [value]="99.99" suffix="%" [decimals]="2" />
 * <app-rolling-counter [value]="50000" prefix="$" />
 * ```
 */
@Component({
  selector: 'app-rolling-counter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span #out aria-hidden="true">{{ initialText }}</span>`,
  styles: [
    `
      :host {
        display: inline-block;
        font-variant-numeric: tabular-nums;
        font-feature-settings: 'tnum' 1;
      }
    `,
  ],
})
export class RollingCounterComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Final numeric value rendered at end of animation. */
  @Input({ required: true }) value!: number;

  /** Animation duration in ms. */
  @Input() duration = 1400;

  /** Optional prefix (e.g. `$`). */
  @Input() prefix = '';

  /** Optional suffix (e.g. `+`, `%`, `K`). */
  @Input() suffix = '';

  /** Decimal places. */
  @Input() decimals = 0;

  /** Locale for `Intl.NumberFormat`. */
  @Input() locale = 'en-US';

  /** IntersectionObserver visibility threshold (0-1). */
  @Input() threshold = 0.4;

  @HostBinding('attr.role') readonly role = 'text';
  @HostBinding('attr.aria-live') readonly ariaLive = 'off';

  @ViewChild('out', { static: true }) private outRef!: ElementRef<HTMLSpanElement>;

  initialText = '';
  private observer?: IntersectionObserver;
  private rafId?: number;
  private started = false;

  ngOnInit(): void {
    const isBrowser = isPlatformBrowser(this.platformId);
    const reduce = isBrowser && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // aria-label always reflects the final value so AT users get the truth.
    this.host.nativeElement.setAttribute('aria-label', this.format(this.value));

    if (!isBrowser || reduce || typeof IntersectionObserver === 'undefined') {
      this.snapToEnd();
      return;
    }

    // Start at 0 to give the rolling effect visual weight.
    this.write(0);

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !this.started) {
            this.started = true;
            this.observer?.disconnect();
            this.run();
          }
        }
      },
      { threshold: this.threshold }
    );
    this.observer.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
  }

  private snapToEnd(): void {
    this.initialText = this.format(this.value);
    this.write(this.value);
  }

  private run(): void {
    const start = performance.now();
    const from = 0;
    const to = this.value;
    const dur = Math.max(120, this.duration);

    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / dur);
      // easeOutQuart — sharp at start, gentle settle. Reads as "rolling slot".
      const eased = 1 - Math.pow(1 - t, 4);
      this.write(from + (to - from) * eased);
      if (t < 1) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.write(to);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private write(n: number): void {
    if (this.outRef?.nativeElement) {
      this.outRef.nativeElement.textContent = this.format(n);
    }
  }

  private format(n: number): string {
    const formatted = n.toLocaleString(this.locale, {
      minimumFractionDigits: this.decimals,
      maximumFractionDigits: this.decimals,
    });
    return `${this.prefix}${formatted}${this.suffix}`;
  }
}
