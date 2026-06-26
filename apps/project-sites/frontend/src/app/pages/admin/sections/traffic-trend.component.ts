import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { ApiService } from '../../../services/api.service';
import { TrendMetricToggleComponent, type TrendMetric } from './trend-metric-toggle.component';

interface DailyPoint {
  day: string;
  pageviews: number;
  uniqueSessions: number;
  conversions: number;
}
interface DailySeriesResponse {
  days?: DailyPoint[];
}

/**
 * AN5 follow-on — daily traffic trend, a lightweight CSS bar strip over the
 * `analytics_daily` rollup. Gives owners a multi-day shape (which they couldn't
 * see from the current-vs-previous summary). No charting lib — pure flex bars,
 * so it stays in the initial bundle without weight.
 *
 * @example
 * <app-traffic-trend [siteId]="s.siteId" />
 */
@Component({
  selector: 'app-traffic-trend',
  standalone: true,
  imports: [TrendMetricToggleComponent],
  template: `
    <section class="mt-6" data-testid="traffic-trend">
      <div class="flex items-center justify-between gap-3 flex-wrap mb-2">
        <h2 class="text-[0.95rem] font-bold text-white m-0">
          Daily traffic
          @if (points().length) {
            <span class="text-text-secondary font-normal text-[0.8rem]">· last {{ points().length }} days</span>
          }
        </h2>
        @if (points().length) {
          <app-trend-metric-toggle [selected]="metric()" (change)="metric.set($event)" />
        }
      </div>

      @if (!points().length) {
        <p class="text-[0.82rem] text-text-secondary" data-testid="tt-empty">
          No daily data yet — the rollup populates each morning. Check back tomorrow.
        </p>
      } @else {
        <div
          class="flex items-end gap-1 h-24 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
          role="img"
          [attr.aria-label]="ariaLabel()">
          @for (p of points(); track p.day) {
            <div
              class="flex-1 min-w-[3px] rounded-t bg-primary/70 hover:bg-primary transition-colors"
              data-testid="tt-bar"
              [style.height.%]="barPct(metricValue(p))"
              [attr.title]="p.day + ': ' + p.pageviews + ' views · ' + p.uniqueSessions + ' visitors · ' + p.conversions + ' conversions'"></div>
          }
        </div>
        <p class="text-[0.78rem] text-text-secondary mt-2 tabular-nums" data-testid="tt-total">
          {{ totalPageviews() }} {{ metricLabel() }} over {{ points().length }} days
        </p>
      }
    </section>
  `,
})
export class TrafficTrendComponent {
  private readonly api = inject(ApiService);

  /** Site RECORD id (analytics_daily.site_id) — passed by the parent summary. */
  readonly siteId = input.required<string>();

  readonly points = signal<DailyPoint[]>([]);
  /** Which metric the bars plot — all three are already on the wire. */
  readonly metric = signal<TrendMetric>('pageviews');

  readonly maxPv = computed(() => Math.max(1, ...this.points().map((p) => this.metricValue(p))));
  readonly totalPageviews = computed(() =>
    this.points().reduce((a, p) => a + this.metricValue(p), 0),
  );
  readonly metricLabel = computed(() =>
    this.metric() === 'uniqueSessions' ? 'visitors' : this.metric() === 'conversions' ? 'conversions' : 'views',
  );
  readonly ariaLabel = computed(
    () => `Daily ${this.metricLabel()} trend — ${this.totalPageviews()} total over ${this.points().length} days`,
  );

  constructor() {
    effect(() => {
      const id = this.siteId();
      if (id) this.load(id);
    });
  }

  /** The currently-selected metric's value for a day. */
  metricValue(p: DailyPoint): number {
    return p[this.metric()] ?? 0;
  }

  /** Bar height as a % of the busiest day, with a 2% floor so quiet days show. */
  barPct(value: number): number {
    return Math.max(2, Math.round((value / this.maxPv()) * 100));
  }

  private load(siteId: string): void {
    this.api
      .get<{ data?: DailySeriesResponse }>(
        `/sites/${siteId}/analytics/daily`,
        { days: '30' },
        { silent: true },
      )
      .subscribe({
        next: (res) => this.points.set(res?.data?.days ?? []),
        error: () => this.points.set([]),
      });
  }
}
