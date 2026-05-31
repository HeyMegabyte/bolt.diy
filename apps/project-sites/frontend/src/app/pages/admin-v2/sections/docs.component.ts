/**
 * @module pages/admin-v2/sections/docs
 *
 * V2 Docs section (SYS-ADMIN, org-wide) — the self-documenting API surface via
 * `getDocsStats()`: animated count cards (public / authed / rate-limited), a
 * category breakdown bar, and a recent-endpoints feed. Org-scoped. Embodies the
 * project's "AI is the primary developer; the system must be self-explaining"
 * non-negotiable. 4-state on helm primitives per [[spartan-ui-design-system]].
 *
 * @example Routed as the `docs` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService, type DocsStats } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { RelativeDatePipe } from './relative-date.pipe';

type DocsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; stats: DocsStats };

@Component({
  selector: 'app-v2-docs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmBadgeDirective,
    RollingCounterComponent,
    RelativeDatePipe,
  ],
  template: `
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-foreground">Docs</h2>
      <p class="text-sm text-muted-foreground">Self-documenting API surface — every route, categorized</p>
    </div>

    @switch (state().status) {
      @case ('loading') {
        <div class="grid grid-cols-3 gap-3" data-testid="v2-docs-loading">
          @for (s of [0,1,2]; track s) { <div hlmCard class="h-24 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-docs-error">
          <h3 hlmCardTitle>Couldn't load docs</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        <section class="grid grid-cols-3 gap-3" data-testid="v2-docs-stats">
          <div hlmCard>
            <p hlmCardDescription class="uppercase tracking-wider text-[0.6rem]">Public</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-foreground"><app-rolling-counter [value]="s()!.public" /></p>
          </div>
          <div hlmCard>
            <p hlmCardDescription class="uppercase tracking-wider text-[0.6rem]">Authenticated</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-foreground"><app-rolling-counter [value]="s()!.authed" /></p>
          </div>
          <div hlmCard>
            <p hlmCardDescription class="uppercase tracking-wider text-[0.6rem]">Rate-limited</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-foreground"><app-rolling-counter [value]="s()!.rate_limited" /></p>
          </div>
        </section>

        @if (categories().length > 0) {
          <div hlmCard class="mt-3" data-testid="v2-docs-categories">
            <h3 hlmCardTitle>Endpoints by category</h3>
            <ul class="mt-3 flex flex-col gap-2">
              @for (cat of categories(); track cat.name) {
                <li class="flex items-center gap-3 text-sm">
                  <span class="w-40 truncate text-muted-foreground">{{ cat.name }}</span>
                  <div class="flex-1 h-2 rounded bg-card border border-border overflow-hidden">
                    <div class="h-full bg-primary/60" [style.width.%]="pct(cat.count)"></div>
                  </div>
                  <span class="w-8 text-right tabular-nums text-muted-foreground"><app-rolling-counter [value]="cat.count" /></span>
                </li>
              }
            </ul>
          </div>
        }

        @if (s()!.recent.length > 0) {
          <div class="mt-3 mb-2 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-foreground">Recently added</h3>
            <span class="text-xs text-muted-foreground tabular-nums" [title]="s()!.generated_at">as of {{ s()!.generated_at | relativeDate }}</span>
          </div>
          <ul hlmCard class="p-0 divide-y divide-border/50 font-mono text-xs" data-testid="v2-docs-recent">
            @for (ep of s()!.recent; track ep.path + ep.method) {
              <li class="flex items-center gap-3 px-3 py-2" data-testid="v2-docs-recent-row">
                <span hlmBadge [variant]="methodVariant(ep.method)" class="shrink-0">{{ ep.method }}</span>
                <span class="flex-1 min-w-0 truncate text-foreground">{{ ep.path }}</span>
                @if (ep.category) { <span class="text-muted-foreground shrink-0">{{ ep.category }}</span> }
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class V2DocsComponent {
  private readonly api = inject(ApiService);

  protected readonly state = toSignal(
    this.api.getDocsStats().pipe(
      map((r) => ({ status: 'ready', stats: r.data }) as DocsState),
      startWith({ status: 'loading' } as DocsState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as DocsState),
      ),
    ),
    { initialValue: { status: 'loading' } as DocsState },
  );

  protected readonly s = computed(() => {
    const st = this.state();
    return st.status === 'ready' ? st.stats : null;
  });
  protected readonly errMsg = computed(() => {
    const st = this.state();
    return st.status === 'error' ? st.message : '';
  });

  protected readonly categories = computed(() => {
    const counts = this.s()?.category_counts ?? {};
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  });

  private readonly maxCat = computed(() => Math.max(1, ...this.categories().map((c) => c.count)));
  protected pct(count: number): number {
    return Math.round((count / this.maxCat()) * 100);
  }

  protected methodVariant(method: string): BadgeVariant {
    switch ((method || '').toUpperCase()) {
      case 'GET':
        return 'success';
      case 'POST':
        return 'info';
      case 'PUT':
      case 'PATCH':
        return 'warning';
      case 'DELETE':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  protected reload(): void {
    location.reload();
  }
}
