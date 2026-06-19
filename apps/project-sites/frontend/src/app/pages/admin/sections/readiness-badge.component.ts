import {
  Component,
  input,
  signal,
  effect,
  inject,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../../services/api.service';

interface ReadinessData {
  grade: string;
  score: number | null;
  passing: boolean | null;
  summary: string | null;
  checkedAt?: string;
}

/**
 * Production-Readiness grade badge (backlog #9) for a site. Fetches
 * `/api/sites/:id/readiness` and renders an A–F badge + score with the human
 * summary as a tooltip. Silent + graceful: a site with no scored build (or a
 * pre-#9 build) renders nothing. Reusable anywhere a `[siteId]` (site record id)
 * is in hand.
 *
 * @remarks
 * Lazy: the readiness fetch fires only once the badge scrolls into view
 * (IntersectionObserver, 150px pre-margin). In a long sites list that means only
 * the visible rows hit the API instead of all N on load. Above-the-fold
 * placements (site-detail header, Live Events) intersect immediately, so there
 * is no perceptible delay there. SSR or a runtime without IntersectionObserver
 * falls back to an eager fetch.
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
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);

  /** Site RECORD id (sites.id), not the slug. */
  readonly siteId = input<string | null>(null);
  readonly data = signal<ReadinessData | null>(null);

  /** Flips true once the badge enters the viewport — gates the fetch. */
  private readonly visible = signal(false);

  constructor() {
    // No IntersectionObserver (SSR / unsupported) → fetch eagerly. Otherwise
    // register on the host element; IO fires once it attaches + scrolls into
    // view (or immediately, for above-the-fold placements).
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

    effect(() => {
      const id = this.siteId();
      if (!id) {
        this.data.set(null);
        return;
      }
      if (!this.visible()) return; // wait until scrolled into view
      this.api
        .get<{ data: ReadinessData | null }>(`/sites/${id}/readiness`, undefined, { silent: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => this.data.set(res?.data ?? null),
          error: () => this.data.set(null),
        });
    });
  }
}
