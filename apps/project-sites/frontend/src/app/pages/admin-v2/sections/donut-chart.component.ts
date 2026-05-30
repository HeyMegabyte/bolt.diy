/**
 * @module pages/admin-v2/sections/donut-chart
 *
 * Lazy Apache ECharts donut — the first chart in the Spartan cockpit. ECharts
 * is dynamically `import()`-ed inside `afterNextRender`, so it lands in its own
 * lazy chunk and never bloats the initial bundle (addresses the bundle-budget
 * constraint). Cockpit-themed (transparent canvas, cyan/helm palette), honors
 * `prefers-reduced-motion`, disposes + resizes cleanly. Data is a signal input
 * so the chart re-renders reactively. Per [[visualization-maps-diagrams-supervisor]]
 * (charts help decisions) + [[package-preference-registry]] (ECharts = the
 * dashboard chart lib).
 *
 * @example `<app-v2-donut [slices]="buckets()" title="Status" />`
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

export interface DonutSlice {
  name: string;
  value: number;
  /** Any CSS color — cockpit cyan/helm tokens resolved to hex by the caller. */
  color: string;
}

@Component({
  selector: 'app-v2-donut',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="relative">
      @if (title()) {
        <figcaption class="sr-only">{{ title() }} breakdown chart</figcaption>
      }
      <div #host class="h-48 w-full" role="img" [attr.aria-label]="ariaLabel()"></div>
    </figure>
  `,
})
export class V2DonutComponent {
  readonly slices = input.required<DonutSlice[]>();
  readonly title = input<string>('');

  private readonly hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly destroyRef = inject(DestroyRef);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- echarts ECharts instance, typed via dynamic import
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
    // Re-render whenever the slices signal changes (after the chart exists).
    effect(() => {
      this.slices();
      if (this.chart) this.render();
    });
  }

  protected ariaLabel(): string {
    return this.slices()
      .filter((s) => s.value > 0)
      .map((s) => `${s.name}: ${s.value}`)
      .join(', ') || 'No data';
  }

  private reduceMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private render(): void {
    const data = this.slices().filter((s) => s.value > 0);
    this.chart.setOption({
      animation: !this.reduceMotion(),
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', backgroundColor: '#071014', borderColor: 'rgba(0,229,255,0.22)', textStyle: { color: '#e8fbff' } },
      legend: {
        bottom: 0,
        textStyle: { color: '#7aa7b3', fontSize: 11 },
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
      },
      series: [
        {
          type: 'pie',
          radius: ['56%', '80%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: false,
          itemStyle: { borderColor: '#03070a', borderWidth: 2 },
          label: { show: false },
          labelLine: { show: false },
          data: data.map((s) => ({ name: s.name, value: s.value, itemStyle: { color: s.color } })),
        },
      ],
    });
  }
}
