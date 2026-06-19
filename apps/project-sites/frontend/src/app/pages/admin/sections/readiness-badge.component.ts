import {
  Component,
  input,
  signal,
  computed,
  effect,
  inject,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ReadinessCacheService, type ReadinessData } from '../../../services/readiness-cache.service';

/**
 * Production-Readiness grade badge (backlog #9) for a site. Renders an A–F badge
 * + score with the human summary as a tooltip; a site with no scored build (or a
 * pre-#9 build) renders nothing.
 *
 * @remarks
 * Lazy + batched: the badge registers its id with {@link ReadinessCacheService}
 * only once it scrolls into view (IntersectionObserver, 150px pre-margin). The
 * cache coalesces all visible badges' ids into a single `GET /api/readiness?ids=…`
 * call, so a long sites list costs ~1-2 requests instead of one-per-row. Above-
 * the-fold placements (site-detail header, Live Events) register immediately.
 * SSR / no-IntersectionObserver registers eagerly.
 */
@Component({
  selector: 'app-readiness-badge',
  standalone: true,
  template: `
    @if (data(); as r) {
      <span
        class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.75rem] font-bold border"
        [class.text-emerald-300]="r.grade === 'A' || r.grade === 'B'"
        [class.border-emerald-400_30]="r.grade === 'A' || r.grade === 'B'"
        [class.text-amber-300]="r.grade === 'C'"
        [class.text-rose-300]="r.grade === 'D' || r.grade === 'F'"
        data-testid="readiness-badge"
        [attr.title]="r.summary || ('Readiness ' + r.grade)">
        <span aria-hidden="true">🛡</span>
        <span>Readiness {{ r.grade }}</span>
        @if (r.score !== null) {
          <span class="opacity-70 tabular-nums">{{ r.score }}/100</span>
        }
      </span>
    }
  `,
})
export class ReadinessBadgeComponent {
  private readonly cache = inject(ReadinessCacheService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);

  /** Site RECORD id (sites.id), not the slug. */
  readonly siteId = input<string | null>(null);

  /** Flips true once the badge enters the viewport — gates the request. */
  private readonly visible = signal(false);

  /** This site's grade from the shared cache; null until a batch resolves it. */
  readonly data = computed<ReadinessData | null>(() => {
    const id = this.siteId();
    if (!id || !this.visible()) return null;
    return this.cache.read(id)();
  });

  constructor() {
    // No IntersectionObserver (SSR / unsupported) → register eagerly. Otherwise
    // observe the host; it registers once it attaches + scrolls into view (or
    // immediately, for above-the-fold placements).
    if (!isPlatformBrowser(this.platformId) || typeof IntersectionObserver === 'undefined') {
      this.visible.set(true);
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            this.visible.set(true);
            io.disconnect(); // readiness is static per view — observe once
          }
        },
        { rootMargin: '150px' },
      );
      io.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => io.disconnect());
    }

    // Register this id for the next batch once visible.
    effect(() => {
      const id = this.siteId();
      if (id && this.visible()) this.cache.request(id);
    });
  }
}
