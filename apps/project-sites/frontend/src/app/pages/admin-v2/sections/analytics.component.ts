/**
 * @module pages/admin-v2/sections/analytics
 *
 * V2 Analytics overview — an aggregate cockpit view derived from the site list
 * (total / published / building / error counts + a status breakdown bar). Kept
 * dependency-light on purpose: it reads the same `listSites()` stream the Sites
 * section uses, so it can't drift from a separate analytics endpoint. Per-site
 * deep analytics live in the legacy `/admin/analytics` section until migrated.
 * 4-state contract on helm primitives per [[spartan-ui-design-system]].
 *
 * @example Routed as the `analytics` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService, type Site } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';

type Status = 'loading' | 'error' | 'ready';
interface Bucket {
  label: string;
  count: number;
  variant: BadgeVariant;
}

@Component({
  selector: 'app-v2-analytics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmBadgeDirective,
    RollingCounterComponent,
  ],
  template: `
    @switch (status()) {
      @case ('loading') {
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="v2-analytics-loading">
          @for (s of [0, 1, 2, 3]; track s) {
            <div hlmCard class="h-24 animate-pulse opacity-60"></div>
          }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-analytics-error">
          <h3 hlmCardTitle>Couldn't load analytics</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        <section class="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="v2-analytics-stats">
          @for (stat of stats(); track stat.label) {
            <div hlmCard>
              <p hlmCardDescription class="uppercase tracking-wider text-[0.6rem]">{{ stat.label }}</p>
              <p class="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                <app-rolling-counter [value]="stat.count" />
              </p>
            </div>
          }
        </section>

        <div hlmCard class="mt-4" data-testid="v2-analytics-breakdown">
          <h3 hlmCardTitle>Status breakdown</h3>
          @if (total() === 0) {
            <p hlmCardDescription class="mt-1">No sites to summarize yet.</p>
          } @else {
            <ul class="mt-3 flex flex-col gap-2">
              @for (b of buckets(); track b.label) {
                <li class="flex items-center gap-3 text-sm">
                  <span hlmBadge [variant]="b.variant" class="w-24 justify-center">{{ b.label }}</span>
                  <div class="flex-1 h-2 rounded bg-card border border-border overflow-hidden">
                    <div class="h-full bg-primary/60" [style.width.%]="pct(b.count)"></div>
                  </div>
                  <span class="w-10 text-right tabular-nums text-muted-foreground">
                    <app-rolling-counter [value]="b.count" />
                  </span>
                </li>
              }
            </ul>
          }
        </div>
      }
    }
  `,
})
export class V2AnalyticsComponent {
  private readonly api = inject(ApiService);

  private readonly sites = toSignal(
    this.api.listSites().pipe(
      map((res: { data: Site[] }) => ({ status: 'ready' as const, sites: res.data ?? [] })),
      startWith({ status: 'loading' as const, sites: [] as Site[] }),
      catchError((e: unknown) =>
        of({
          status: 'error' as const,
          sites: [] as Site[],
          message: (e as { message?: string })?.message ?? 'Network error',
        }),
      ),
    ),
    { initialValue: { status: 'loading' as const, sites: [] as Site[] } },
  );

  protected readonly status = computed<Status>(() => this.sites().status);
  protected readonly errMsg = computed(() => {
    const s = this.sites();
    return 'message' in s ? (s as { message?: string }).message ?? '' : '';
  });

  private readonly list = computed(() => this.sites().sites);
  protected readonly total = computed(() => this.list().length);
  private count(pred: (s: Site) => boolean): number {
    return this.list().filter(pred).length;
  }

  protected readonly stats = computed(() => [
    { label: 'Total sites', count: this.total() },
    { label: 'Published', count: this.count((s) => s.status === 'published') },
    { label: 'Building', count: this.count((s) => s.status === 'building' || s.status === 'generating') },
    { label: 'Needs attention', count: this.count((s) => s.status === 'error') },
  ]);

  protected readonly buckets = computed<Bucket[]>(() => [
    { label: 'Published', count: this.count((s) => s.status === 'published'), variant: 'success' },
    {
      label: 'Building',
      count: this.count((s) => s.status === 'building' || s.status === 'generating'),
      variant: 'info',
    },
    { label: 'Draft', count: this.count((s) => s.status === 'draft' || s.status === 'collecting'), variant: 'neutral' },
    { label: 'Error', count: this.count((s) => s.status === 'error'), variant: 'danger' },
  ]);

  protected pct(count: number): number {
    const t = this.total();
    return t === 0 ? 0 : Math.round((count / t) * 100);
  }

  protected reload(): void {
    location.reload();
  }
}
