/**
 * @module pages/admin-v2/sections/bar-chart
 *
 * Lazy Apache ECharts bar — sibling to the donut, same lean contract: dynamic
 * `import('echarts')` inside `afterNextRender` → own lazy chunk (shared with the
 * donut), cockpit-themed, `prefers-reduced-motion` aware, ResizeObserver +
 * dispose. Reactive `bars` signal input. Used by the Cost section for the daily
 * spend series. Per [[visualization-maps-diagrams-supervisor]] +
 * [[package-preference-registry]].
 *
 * @example `<app-v2-bar [bars]="daily()" prefix="$" />`
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  effect,
  input,
  viewChild,
  DestroyRef,
  inject,
} from '@angular/core';

export interface BarPoint {
  label: string;
  value: number;
}

@Component({
  selector: 'app-v2-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="h-56 w-full" role="img" [attr.aria-label]="ariaLabel()"></div>`,
})
export class V2BarComponent {
  readonly bars = input.required<BarPoint[]>();
  readonly prefix = input<string>('');

  private readonly hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly destroyRef = inject(DestroyRef);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- echarts instance, typed via dynamic import
  private chart: any = null;
  private resizeObs: ResizeObserver | null = null;

  constructor() {
    afterNextRender(async () => {
      const echarts = await import('echarts');
      const el = this.hostRef().nativeElement;
      this.chart = echarts.init(el, undefined, { renderer: 'canvas' });
      this.render();
      this.resizeObs = new ResizeObserver(() => this.chart?.resize());
      this.resizeObs.observe(el);
      this.destroyRef.onDestroy(() => {
        this.resizeObs?.disconnect();
        this.chart?.dispose();
        this.chart = null;
      });
    });
    effect(() => {
      this.bars();
      if (this.chart) this.render();
    });
  }

  protected ariaLabel(): string {
    const b = this.bars();
    if (!b.length) return 'No data';
    const max = b.reduce((m, x) => (x.value > m.value ? x : m), b[0]);
    return `${b.length} bars, peak ${this.prefix()}${max.value} on ${max.label}`;
  }

  private reduceMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private render(): void {
    const b = this.bars();
    const pfx = this.prefix();
    this.chart.setOption({
      animation: !this.reduceMotion(),
      backgroundColor: 'transparent',
      grid: { left: 44, right: 12, top: 12, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#071014',
        borderColor: 'rgba(0,229,255,0.22)',
        textStyle: { color: '#e8fbff' },
        valueFormatter: (v: number) => `${pfx}${(+v).toFixed(2)}`,
      },
      xAxis: {
        type: 'category',
        data: b.map((x) => x.label),
        axisLine: { lineStyle: { color: 'rgba(0,229,255,0.18)' } },
        axisLabel: { color: '#7aa7b3', fontSize: 10, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(0,229,255,0.08)' } },
        axisLabel: { color: '#7aa7b3', fontSize: 10, formatter: (v: number) => `${pfx}${v}` },
      },
      series: [
        {
          type: 'bar',
          data: b.map((x) => x.value),
          itemStyle: { color: '#00e5ff', borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 22,
        },
      ],
    });
  }
}
