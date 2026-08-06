import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostBinding,
  Input,
  type OnChanges,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  type SimpleChanges,
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
export class RollingCounterComponent implements OnInit, OnDestroy, OnChanges {
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
  private fallbackTimer?: number;
  private started = false;

  ngOnInit(): void {
    // Defense-in-depth: `value` is `required`, but a caller passing undefined/NaN
    // (e.g. a stats-shape mismatch) must never crash the counter — and it's rendered
    // in dashboards/analytics/super-admin, so one bad binding would take down the
    // whole section via the error boundary. Coerce to a finite number ONCE.
    if (!Number.isFinite(this.value)) this.value = 0;

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
            if (this.fallbackTimer != null) clearTimeout(this.fallbackTimer);
            this.observer?.disconnect();
            this.run();
          }
        }
      },
      { threshold: this.threshold }
    );
    this.observer.observe(this.host.nativeElement);

    // Fallback: a below-fold counter never scrolled into view would sit at its
    // initial 0 forever (the observer only fires on intersection). Snap to the real
    // value after a short grace period so an off-screen counter is still correct —
    // a footer "0 site in your account" while the account HAS a site is a bug the
    // roll-from-0 effect must never cause. (Above-fold counters intersect within a
    // tick and roll well before this fires.)
    this.fallbackTimer = window.setTimeout(() => {
      if (!this.started) {
        this.started = true;
        this.observer?.disconnect();
        this.snapToEnd();
      }
    }, 2500);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    if (this.fallbackTimer != null) clearTimeout(this.fallbackTimer);
  }

  ngOnChanges(changes: SimpleChanges): void {
    // React to a LATE value change. `[value]` is frequently bound to an async
    // signal (e.g. `numbers().length` / `monthlySpend()`) that is 0 at init and
    // resolves to the real value after an API load. Without this, the counter
    // captured 0 in ngOnInit, animated 0→0, disconnected the observer, and was
    // stuck at 0 next to the real data (a "0 / 3 · $0.00" stat above a populated
    // list). On a non-first value change, re-run to the new target if we've
    // already animated (in view); if not yet in view, the pending observer run()
    // reads the fresh value.
    const change = changes['value'];
    if (!change || change.firstChange) return;
    if (!Number.isFinite(this.value)) this.value = 0;
    this.host.nativeElement.setAttribute('aria-label', this.format(this.value));
    if (this.started) {
      if (this.rafId != null) cancelAnimationFrame(this.rafId);
      this.run();
    } else {
      // Below-fold counter whose bound value resolved late (0 → real) BEFORE it ever
      // scrolled into view: without this it sits at a stale 0 forever (the observer
      // never fires off-screen). Reflect the resolved value immediately and stop
      // waiting to roll — a footer "0 site in your account" while the account HAS a
      // site (caught by scan-admin-hub) is worse than skipping the roll animation.
      this.write(this.value);
      this.started = true;
      this.observer?.disconnect();
    }
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
