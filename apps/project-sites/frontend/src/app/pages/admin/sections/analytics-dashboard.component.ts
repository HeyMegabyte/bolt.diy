import { Component, signal, inject, DestroyRef, type OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminAnalyticsComponent } from './analytics.component';
import { AdminAnalyticsLiveComponent } from './analytics-live.component';

type AnalyticsTab = 'overview' | 'live';

/**
 * Unified analytics dashboard (2026-06-23) — combines the former standalone
 * "Analytics" (`/admin/analytics`) and "Live Events" (`/admin/analytics-live`)
 * sidebar items into ONE surface with two tabs. Aggregate traffic and the raw
 * event stream are the same system, so they live together now. Mirrors the
 * `logs-dashboard` pattern (Audit Trail + Log Explorer in one tabbed surface).
 *
 * Deep-linkable + bookmarkable via `?tab=overview|live` (shared admin pattern)
 * so `/admin/analytics?tab=live` lands directly on Live Events and the legacy
 * `/admin/analytics-live` route redirects here too.
 */
@Component({
  selector: 'app-admin-analytics-dashboard',
  standalone: true,
  imports: [AdminAnalyticsComponent, AdminAnalyticsLiveComponent],
  template: `
    <div class="px-6 pt-5 pb-2 max-md:px-4" data-testid="analytics-dashboard">
      <h1 class="text-[1.35rem] font-extrabold text-white tracking-tight m-0">Analytics</h1>
      <p class="text-[0.82rem] text-text-secondary mt-1 mb-3">
        Aggregate traffic + the raw live event stream — one place for everything visitors do.
      </p>
      <div class="inline-flex gap-1 p-1 rounded-xl border border-white/[0.06] bg-white/[0.02]" role="tablist" aria-label="Analytics view">
        @for (t of tabs; track t.id) {
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="tab() === t.id"
            [attr.data-testid]="'analytics-tab-' + t.id"
            class="px-3.5 py-1.5 rounded-lg text-[0.8rem] font-semibold transition-all cursor-pointer"
            [class.bg-primary]="tab() === t.id"
            [class.text-dark]="tab() === t.id"
            [class.text-text-secondary]="tab() !== t.id"
            [class.hover:text-white]="tab() !== t.id"
            (click)="select(t.id)">
            {{ t.label }}
          </button>
        }
      </div>
    </div>

    @if (tab() === 'overview') {
      <app-admin-analytics />
    } @else {
      <app-admin-analytics-live />
    }
  `,
})
export class AdminAnalyticsDashboardComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly tabs: ReadonlyArray<{ id: AnalyticsTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'live', label: 'Live Events' },
  ];
  readonly tab = signal<AnalyticsTab>('overview');

  ngOnInit(): void {
    // Sync the active tab from `?tab=` so the view is deep-linkable + back/forward
    // restores it. takeUntilDestroyed: ActivatedRoute observables never complete.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      this.tab.set(q.get('tab') === 'live' ? 'live' : 'overview');
    });
  }

  select(tab: AnalyticsTab): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
    });
  }
}
