import { Component, input, signal, effect, inject, DestroyRef } from '@angular/core';
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

  /** Site RECORD id (sites.id), not the slug. */
  readonly siteId = input<string | null>(null);
  readonly data = signal<ReadinessData | null>(null);

  constructor() {
    effect(() => {
      const id = this.siteId();
      if (!id) {
        this.data.set(null);
        return;
      }
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
