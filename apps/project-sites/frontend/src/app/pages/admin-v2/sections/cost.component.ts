/**
 * @module pages/admin-v2/sections/cost
 *
 * V2 Cost section — AI build-cost forecast (the project's NON-NEGOTIABLE credit
 * discipline made visible). Reads `getCostForecast(30)` → stat cards (animated
 * via `<app-rolling-counter>`), a plan-cap progress bar, and a daily-spend
 * ECharts bar (`<app-v2-bar>`). 4-state on helm primitives per
 * [[spartan-ui-design-system]] + [[angular-large-app-supervisor]].
 *
 * @example Routed as the `cost` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService, type CostForecastV2 } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
} from '../../../ui';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { V2BarComponent, type BarPoint } from './bar-chart.component';

type CostState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; cost: CostForecastV2 };

@Component({
  selector: 'app-v2-cost',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    RollingCounterComponent,
    V2BarComponent,
  ],
  template: `
    @switch (state().status) {
      @case ('loading') {
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="v2-cost-loading">
          @for (s of [0,1,2,3]; track s) { <div hlmCard class="h-24 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-cost-error">
          <h3 hlmCardTitle>Couldn't load cost forecast</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        <section class="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="v2-cost-stats">
          <div hlmCard>
            <p hlmCardDescription class="uppercase tracking-wider text-[0.6rem]">This period</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              <app-rolling-counter [value]="c()!.current_period_usd" prefix="$" [decimals]="2" />
            </p>
          </div>
          <div hlmCard>
            <p hlmCardDescription class="uppercase tracking-wider text-[0.6rem]">Projected</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              <app-rolling-counter [value]="c()!.projected_usd" prefix="$" [decimals]="2" />
            </p>
          </div>
          <div hlmCard>
            <p hlmCardDescription class="uppercase tracking-wider text-[0.6rem]">Daily avg</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              <app-rolling-counter [value]="c()!.rolling_daily_avg" prefix="$" [decimals]="2" />
            </p>
          </div>
          <div hlmCard>
            <p hlmCardDescription class="uppercase tracking-wider text-[0.6rem]">% of cap</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              <app-rolling-counter [value]="c()!.percent_of_cap" suffix="%" />
            </p>
          </div>
        </section>

        @if (c()!.plan_cap_usd != null) {
          <div hlmCard class="mt-3" data-testid="v2-cost-cap">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Plan cap</span>
              <span class="tabular-nums text-foreground">{{ '$' + c()!.plan_cap_usd }}</span>
            </div>
            <div class="mt-2 h-2 rounded bg-card border border-border overflow-hidden">
              <div class="h-full" [style.width.%]="capPct()"
                   [style.background]="capPct() >= 90 ? '#ff4d6d' : capPct() >= 70 ? '#ffd166' : '#00e5ff'"></div>
            </div>
            @if (c()!.days_until_cap_hit != null) {
              <p hlmCardDescription class="mt-1 text-xs">~{{ c()!.days_until_cap_hit }} days until cap at current pace</p>
            }
          </div>
        }

        <div hlmCard class="mt-3" data-testid="v2-cost-chart">
          <h3 hlmCardTitle>Daily spend</h3>
          @if (daily().length === 0) {
            <p hlmCardDescription class="mt-1">No spend recorded in this period.</p>
          } @else {
            <div class="mt-3"><app-v2-bar [bars]="daily()" prefix="$" /></div>
          }
        </div>
      }
    }
  `,
})
export class V2CostComponent {
  private readonly api = inject(ApiService);

  protected readonly state = toSignal(
    this.api.getCostForecast(30).pipe(
      map((r) => ({ status: 'ready', cost: r.data }) as CostState),
      startWith({ status: 'loading' } as CostState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as CostState),
      ),
    ),
    { initialValue: { status: 'loading' } as CostState },
  );

  protected readonly c = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.cost : null;
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected readonly daily = computed<BarPoint[]>(() => {
    const cost = this.c();
    if (!cost?.breakdown) return [];
    return cost.breakdown.map((b) => ({ label: this.shortDay(b.day), value: Number(b.usd.toFixed(2)) }));
  });

  protected capPct(): number {
    const cost = this.c();
    return Math.min(100, Math.max(0, Math.round(cost?.percent_of_cap ?? 0)));
  }

  private shortDay(day: string): string {
    // "2026-05-29" → "05-29"
    const m = /^\d{4}-(\d{2}-\d{2})$/.exec(day);
    return m ? m[1] : day;
  }

  protected reload(): void {
    location.reload();
  }
}
