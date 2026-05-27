/**
 * `SiteAnalyticsComponent` — privacy-first per-site analytics dashboard
 * (backlog #27).
 *
 * @remarks
 *  Renders the four payloads from `/_pa/aggregates`:
 *   1. Headline totals (views + uniques over the 7-day window).
 *   2. Top pages table.
 *   3. Top referrers table.
 *   4. Daily trend sparkline (7 bars, scaled to the busiest day).
 *
 *  RxJS-first per `[[rxjs-first-angular]]`. Polls every 30s via the service.
 *  No charts library — pure CSS bars keep the bundle lean.
 */
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, switchMap } from 'rxjs';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import {
  AnalyticsService,
  type AnalyticsAggregates,
} from '@org/data-access';

@Component({
  selector: 'lib-site-analytics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, CardModule, TagModule, DecimalPipe, DatePipe],
  template: `
    <section class="site-analytics" data-testid="site-analytics">
      <header class="hdr">
        <h2>Visitors</h2>
        <small>Cookieless · GDPR-clean · last {{ window() }} days</small>
      </header>

      <div class="kpis">
        <p-card>
          <span class="kpi-label">Views</span>
          <span class="kpi-value" data-testid="pa-views">
            {{ totals().views | number }}
          </span>
        </p-card>
        <p-card>
          <span class="kpi-label">Unique visitors</span>
          <span class="kpi-value" data-testid="pa-uniques">
            {{ totals().uniques | number }}
          </span>
        </p-card>
        <p-card>
          <span class="kpi-label">Pages tracked</span>
          <span class="kpi-value">{{ topPages().length | number }}</span>
        </p-card>
      </div>

      <div class="grid">
        <p-card header="Top pages">
          @if (topPages().length === 0) {
            <p class="empty">No pageviews yet — embed
              <code>&lt;script async src="/_pa/script.js"&gt;&lt;/script&gt;</code>
              in the site head.</p>
          } @else {
            <table class="t" data-testid="pa-top-pages">
              <thead>
                <tr><th>Path</th><th>Views</th><th>Uniques</th></tr>
              </thead>
              <tbody>
                @for (row of topPages(); track row.path) {
                  <tr>
                    <td class="path" [title]="row.path">{{ row.path }}</td>
                    <td>{{ row.views | number }}</td>
                    <td>{{ row.uniques | number }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </p-card>

        <p-card header="Top referrers">
          @if (topReferrers().length === 0) {
            <p class="empty">No referrer data yet.</p>
          } @else {
            <table class="t" data-testid="pa-top-refs">
              <thead><tr><th>Source</th><th>Visits</th></tr></thead>
              <tbody>
                @for (row of topReferrers(); track row.source) {
                  <tr>
                    <td>{{ row.source }}</td>
                    <td>{{ row.visits | number }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </p-card>
      </div>

      <p-card header="Daily trend" class="trend">
        <div class="bars" data-testid="pa-trend">
          @for (cell of trend(); track cell.day) {
            <div class="bar" [title]="(cell.day | date) + ' — ' + cell.views + ' views'">
              <span
                class="bar-fill"
                [style.height.%]="barHeight(cell.views)"
                aria-hidden="true"
              ></span>
              <small>{{ cell.day | date: 'EEE' }}</small>
            </div>
          }
        </div>
      </p-card>
    </section>
  `,
  styles: [
    `
      .site-analytics { display: flex; flex-direction: column; gap: 1rem; padding: 1rem; }
      .hdr { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
      .hdr h2 { margin: 0; font-size: 1.25rem; }
      .hdr small { color: var(--text-color-secondary, #8a8a98); }
      .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
      .kpi-label { display: block; font-size: 0.75rem; color: var(--text-color-secondary, #8a8a98); text-transform: uppercase; letter-spacing: 0.04em; }
      .kpi-value { font-size: 1.75rem; font-weight: 700; font-variant-numeric: tabular-nums; }
      .grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 1rem; }
      @media (max-width: 880px) { .kpis, .grid { grid-template-columns: 1fr; } }
      table.t { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
      table.t th, table.t td { padding: 0.4rem 0.5rem; text-align: left; border-bottom: 1px solid var(--surface-border, #2a2a36); }
      table.t .path { max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .empty { color: var(--text-color-secondary, #8a8a98); font-size: 0.9rem; }
      .empty code { background: var(--surface-card, #15151f); padding: 0.1rem 0.3rem; border-radius: 0.25rem; }
      .trend .bars { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.5rem; align-items: end; height: 140px; }
      .bar { display: flex; flex-direction: column; align-items: center; justify-content: end; height: 100%; gap: 0.25rem; }
      .bar-fill { width: 60%; background: linear-gradient(180deg, var(--p-primary-500, #6366f1), var(--p-primary-700, #4338ca)); border-radius: 0.25rem 0.25rem 0 0; min-height: 4px; transition: height 240ms ease; }
      .bar small { font-size: 0.7rem; color: var(--text-color-secondary, #8a8a98); }
    `,
  ],
})
export class SiteAnalyticsComponent {
  @Input({ required: true }) set baseUrl(value: string) {
    this.baseUrl$.next(value);
  }

  private readonly analytics = inject(AnalyticsService);
  private readonly baseUrl$ = new BehaviorSubject<string>('');

  private readonly aggregates = toSignal(
    this.baseUrl$.pipe(switchMap((url) => this.analytics.aggregates$(url))),
    {
      initialValue: {
        window_days: 7,
        totals: { views: 0, uniques: 0 },
        top_pages: [],
        top_referrers: [],
        daily_trend: [],
      } satisfies AnalyticsAggregates,
    },
  );

  protected readonly totals = computed(() => this.aggregates().totals);
  protected readonly topPages = computed(() => this.aggregates().top_pages);
  protected readonly topReferrers = computed(() => this.aggregates().top_referrers);
  protected readonly trend = computed(() => this.aggregates().daily_trend);
  protected readonly window = computed(() => this.aggregates().window_days);

  private readonly trendMax = computed(() => {
    const cells = this.trend();
    if (cells.length === 0) return 1;
    return Math.max(...cells.map((c) => c.views), 1);
  });

  protected barHeight(views: number): number {
    return Math.max(2, Math.round((views / this.trendMax()) * 100));
  }
}
