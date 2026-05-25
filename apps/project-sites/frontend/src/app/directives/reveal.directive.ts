import {
  Directive,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Module-scoped paint counter so multiple `[appReveal]` hosts on the same
 * page get staggered by document order without needing a shared service.
 * Resets implicitly per page reload (which is what we want — every
 * first-paint should re-stagger).
 */
let revealOrderIndex = 0;

/**
 * `appReveal` — first-load fade + 16px translateY animation via Web Animations
 * API, staggered by 80ms in document order. Below-the-fold hosts get
 * IntersectionObserver fallback so they animate when scrolled into view.
 *
 * @remarks
 * - Uses the Web Animations API (`Element.animate`) — no CSS keyframes needed.
 * - Above-the-fold (initial viewport) hosts animate immediately, staggered.
 * - Below-the-fold hosts wait until IntersectionObserver fires, then animate.
 * - Respects `prefers-reduced-motion: reduce` → host stays at final state,
 *   no animation. Never hides content from reduced-motion users.
 * - Safe-by-default — no FOUC, no layout shift. The host starts visible at
 *   the final transform; the animation runs forward over 520ms.
 * - SSR-safe via PLATFORM_ID guard.
 *
 * @example
 * ```html
 * <section appReveal>...</section>
 * <div appReveal [revealDelay]="120">Custom additional delay (ms)</div>
 * ```
 */
@Directive({
  selector: '[appReveal]',
  standalone: true,
})
export class RevealDirective implements OnInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);

  /** Additional delay (ms) on top of the auto document-order stagger. */
  @Input() revealDelay = 0;

  /** Per-host stagger increment (ms). Default 80ms reads as graceful sequence. */
  @Input() revealStep = 80;

  /** Total animation duration (ms). */
  @Input() revealDuration = 520;

  /** Pixel rise applied to the start frame. */
  @Input() revealOffset = 16;

  /** IntersectionObserver threshold for below-the-fold hosts. */
  @Input() revealThreshold = 0.12;

  private observer?: IntersectionObserver;
  private animation?: Animation;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      // Final state, no animation. Never hide content from reduced-motion users.
      return;
    }

    const el = this.host.nativeElement;
    const myIndex = revealOrderIndex++;
    const computedDelay = myIndex * this.revealStep + this.revealDelay;

    // Decide: animate on first paint (in viewport) OR wait for scroll.
    const inViewport = this.isInViewport(el);

    if (inViewport || typeof IntersectionObserver === 'undefined') {
      this.play(computedDelay);
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.observer?.disconnect();
            // Smaller delay once scrolled in — the user is already looking.
            this.play(0);
          }
        }
      },
      { threshold: this.revealThreshold, rootMargin: '0px 0px -6% 0px' }
    );
    this.observer.observe(el);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.animation?.cancel();
  }

  private play(delay: number): void {
    try {
      this.animation = this.host.nativeElement.animate(
        [
          { opacity: 0, transform: `translate3d(0, ${this.revealOffset}px, 0)` },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: this.revealDuration,
          delay,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'backwards',
        }
      );
    } catch {
      // Web Animations API not available — leave host at final state.
    }
  }

  private isInViewport(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return rect.top < vh && rect.bottom > 0;
  }
}
