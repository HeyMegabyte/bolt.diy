import { Component, EventEmitter, Output, input } from '@angular/core';

export type TrendMetric = 'pageviews' | 'uniqueSessions' | 'conversions';

const OPTIONS: ReadonlyArray<{ key: TrendMetric; label: string }> = [
  { key: 'pageviews', label: 'Views' },
  { key: 'uniqueSessions', label: 'Visitors' },
  { key: 'conversions', label: 'Conversions' },
];

/**
 * Segmented control choosing which metric the daily traffic trend plots.
 * All three are already on the wire from `/api/sites/:id/analytics/daily`,
 * so switching is a pure client-side re-render.
 *
 * @example
 * <app-trend-metric-toggle [selected]="metric()" (change)="metric.set($event)" />
 */
@Component({
  selector: 'app-trend-metric-toggle',
  standalone: true,
  template: `
    <div class="inline-flex rounded-lg border border-white/[0.08] overflow-hidden" role="group" aria-label="Trend metric">
      @for (o of options; track o.key) {
        <button
          type="button"
          data-testid="tmt-opt"
          class="px-3 py-1 text-[0.78rem] font-semibold transition-colors"
          [class.bg-primary]="o.key === selected()"
          [class.text-dark]="o.key === selected()"
          [class.text-text-secondary]="o.key !== selected()"
          [attr.aria-pressed]="o.key === selected()"
          (click)="change.emit(o.key)">
          {{ o.label }}
        </button>
      }
    </div>
  `,
})
export class TrendMetricToggleComponent {
  readonly options = OPTIONS;
  readonly selected = input<TrendMetric>('pageviews');
  @Output() readonly change = new EventEmitter<TrendMetric>();
}
