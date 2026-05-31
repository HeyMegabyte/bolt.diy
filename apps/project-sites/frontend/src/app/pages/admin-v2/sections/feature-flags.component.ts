/**
 * @module pages/admin-v2/sections/feature-flags
 *
 * V2 Feature Flags section (SYS-ADMIN, org-wide) — the feature-flag registry via
 * `getFeatureFlags()`: stage-filter pills + search over key/description, each row
 * showing key · stage badge · default enabled/rollout · owner. Read-only for now
 * (promotion/toggle is a super-admin POST surface, intentionally not exposed
 * here yet — honest about scope per the project's no-fake-controls rule).
 * 4-state on helm primitives per [[spartan-ui-design-system]] + [[feature-flags]].
 *
 * @example Routed as the `feature-flags` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService, type FeatureFlag } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmInputDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';

type FlagsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; flags: FeatureFlag[] };

const STAGES = ['all', 'experimental', 'beta', 'stable', 'deprecated', 'killswitch'] as const;
type StageFilter = (typeof STAGES)[number];

@Component({
  selector: 'app-v2-feature-flags',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmInputDirective,
    HlmBadgeDirective,
  ],
  template: `
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-foreground">Feature Flags</h2>
      <p class="text-sm text-muted-foreground">The flag registry — every gated capability, by stage</p>
    </div>

    @switch (state().status) {
      @case ('loading') {
        <div class="flex flex-col gap-2" data-testid="v2-flags-loading">
          @for (s of [0,1,2,3,4]; track s) { <div hlmCard class="h-12 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-flags-error">
          <h3 hlmCardTitle>Couldn't load feature flags</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        <div class="flex flex-wrap items-center gap-2 mb-3" data-testid="v2-flags-controls">
          @for (st of stages; track st) {
            <button hlmBtn size="sm" [variant]="stage() === st ? 'primary' : 'ghost'"
                    (click)="stage.set(st)" class="capitalize"
                    [attr.aria-pressed]="stage() === st"
                    [attr.data-testid]="'v2-flags-stage-' + st">
              {{ st }}@if (st !== 'all') { <span class="ml-1.5 tabular-nums opacity-70">{{ countFor(st) }}</span> }
            </button>
          }
          <span class="flex-1"></span>
          <input hlmInput class="max-w-xs h-8" placeholder="Search flags…"
                 [value]="filter()" (input)="onFilter($event)" data-testid="v2-flags-filter"
                 aria-label="Search feature flags by key or description" />
        </div>

        @if (filtered().length === 0) {
          <div hlmCard class="text-center py-8" data-testid="v2-flags-empty">
            <p hlmCardDescription>No flags match this filter.</p>
          </div>
        } @else {
          <ul hlmCard class="p-0 divide-y divide-border/50" data-testid="v2-flags-list">
            @for (f of filtered(); track f.key) {
              <li class="px-3 py-2.5" data-testid="v2-flags-row">
                <div class="flex items-center gap-2">
                  <span class="font-mono text-sm text-foreground truncate">{{ f.key }}</span>
                  <span hlmBadge [variant]="stageVariant(f.stage)" class="shrink-0 capitalize">{{ f.stage }}</span>
                  @if (f.default_enabled) {
                    <span hlmBadge variant="success" class="shrink-0">on · {{ f.default_rollout_percent }}%</span>
                  } @else {
                    <span hlmBadge variant="neutral" class="shrink-0">off</span>
                  }
                  <span class="flex-1"></span>
                  <span class="text-xs text-muted-foreground truncate max-w-[18ch] shrink-0" [title]="f.owner_email">{{ f.owner_email }}</span>
                </div>
                <p class="mt-1 text-xs text-muted-foreground line-clamp-2">{{ f.description }}</p>
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class V2FeatureFlagsComponent {
  private readonly api = inject(ApiService);
  protected readonly stages = STAGES;
  protected readonly stage = signal<StageFilter>('all');
  protected readonly filter = signal('');

  protected readonly state = toSignal(
    this.api.getFeatureFlags().pipe(
      map((r) => ({ status: 'ready', flags: r.flags ?? [] }) as FlagsState),
      startWith({ status: 'loading' } as FlagsState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as FlagsState),
      ),
    ),
    { initialValue: { status: 'loading' } as FlagsState },
  );

  protected readonly flags = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.flags : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected readonly filtered = computed(() => {
    const st = this.stage();
    const q = this.filter().trim().toLowerCase();
    return this.flags()
      .filter((f) => (st === 'all' ? true : f.stage === st))
      .filter((f) => !q || f.key.toLowerCase().includes(q) || (f.description ?? '').toLowerCase().includes(q));
  });

  protected countFor(stage: StageFilter): number {
    return this.flags().filter((f) => f.stage === stage).length;
  }

  protected onFilter(e: Event): void {
    this.filter.set((e.target as HTMLInputElement).value);
  }

  protected stageVariant(stage: string): BadgeVariant {
    switch (stage) {
      case 'stable':
        return 'success';
      case 'beta':
        return 'info';
      case 'experimental':
        return 'warning';
      case 'killswitch':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  protected reload(): void {
    location.reload();
  }
}
