import { Component, signal, inject, DestroyRef, type OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminAnalyticsComponent } from './analytics.component';
import { AdminAnalyticsLiveComponent } from './analytics-live.component';
import { AdminActivationFunnelComponent } from './activation-funnel.component';
import { AdminSocialAnalyticsComponent } from './social-analytics.component';
import { SectionAttributionComponent } from './section-attribution.component';
import { FormAnalyticsComponent } from './form-analytics.component';

type AnalyticsTab = 'overview' | 'live' | 'funnel' | 'sections' | 'forms' | 'social';

/**
 * Unified analytics dashboard — combines aggregate traffic, the raw live event
 * stream, the activation funnel, and SOCIAL performance into ONE tabbed surface.
 * Social analytics lives here as a dedicated `social` tab (no standalone page),
 * so everything a site owner measures is in one place.
 *
 * Deep-linkable + bookmarkable via `?tab=overview|live|funnel|social`; the legacy
 * `/admin/analytics-live` + `/admin/social/analytics` routes redirect here.
 */
@Component({
  selector: 'app-admin-analytics-dashboard',
  standalone: true,
  imports: [
    AdminAnalyticsComponent,
    AdminAnalyticsLiveComponent,
    AdminActivationFunnelComponent,
    AdminSocialAnalyticsComponent,
    SectionAttributionComponent,
    FormAnalyticsComponent,
  ],
  template: `
    <div class="px-6 pt-5 pb-2 max-md:px-4" data-testid="analytics-dashboard">
      <h1 class="text-[1.35rem] font-extrabold text-white tracking-tight m-0">Analytics</h1>
      <p class="text-[0.82rem] text-text-secondary mt-1 mb-3">
        Traffic, the live event stream, the activation funnel, and social performance — all in one place.
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
    } @else if (tab() === 'live') {
      <app-admin-analytics-live />
    } @else if (tab() === 'funnel') {
      <app-admin-activation-funnel />
    } @else if (tab() === 'sections') {
      <app-section-attribution />
    } @else if (tab() === 'forms') {
      <app-form-analytics />
    } @else {
      <app-social-analytics />
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
    { id: 'funnel', label: 'Activation Funnel' },
    { id: 'sections', label: 'By Section' },
    { id: 'forms', label: 'Forms' },
    { id: 'social', label: 'Social' },
  ];
  readonly tab = signal<AnalyticsTab>('overview');

  ngOnInit(): void {
    // Sync the active tab from `?tab=` so the view is deep-linkable + back/forward
    // restores it. takeUntilDestroyed: ActivatedRoute observables never complete.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      const t = q.get('tab');
      this.tab.set(
        t === 'live' || t === 'funnel' || t === 'sections' || t === 'forms' || t === 'social'
          ? t
          : 'overview',
      );
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
