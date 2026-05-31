/**
 * @module pages/admin-v2/sections/site-build
 *
 * Per-site Build — a SITE-group section driven by the topbar Project dropdown
 * ({@link V2SiteContextService.selectedSite}): the selected site's AI build /
 * generation status via `getWorkflow` (status badge + current step + a
 * steps-completed progress bar). Same dropdown-reactive pattern as the other
 * per-site sections. 4-state + no-site state per [[spartan-ui-design-system]].
 *
 * @example Routed as `site/build` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { ApiService, type WorkflowStatus } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { V2SiteContextService } from '../v2-site-context.service';

type BuildState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; wf: WorkflowStatus };

@Component({
  selector: 'app-v2-site-build',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmBadgeDirective,
    RouterModule,
  ],
  template: `
    @if (!ctx.selectedSite()) {
      <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-site-build-nosite">
        <h3 hlmCardTitle>No site selected</h3>
        <p hlmCardDescription class="mt-1">Pick a project from the dropdown above to see its build status.</p>
      </div>
    } @else {
      <div class="mb-3">
        <h2 class="text-lg font-semibold text-foreground">Build status</h2>
        <p class="text-sm text-muted-foreground">{{ ctx.selectedSite()!.business_name }}</p>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <div hlmCard class="h-28 max-w-lg animate-pulse opacity-60" data-testid="v2-site-build-loading"></div>
        }
        @case ('error') {
          <div hlmCard class="max-w-md mx-auto mt-12 text-center" role="alert" data-testid="v2-site-build-error">
            <h3 hlmCardTitle>Couldn't load build status</h3>
            <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
            <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
          </div>
        }
        @case ('ready') {
          <div hlmCard class="max-w-lg" data-testid="v2-site-build-card">
            <div class="flex items-center justify-between gap-2">
              <h3 hlmCardTitle>Latest build</h3>
              <span hlmBadge [variant]="statusVariant(wf()!.status)">{{ wf()!.status || 'unknown' }}</span>
            </div>
            @if (wf()!.current_step) {
              <p hlmCardDescription class="mt-2">Step: <span class="text-foreground font-mono text-xs">{{ wf()!.current_step }}</span></p>
            }
            @if (total() > 0) {
              <div class="mt-3">
                <div class="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Progress</span>
                  <span class="tabular-nums">{{ done() }} / {{ total() }}</span>
                </div>
                <div class="h-2 rounded bg-card border border-border overflow-hidden">
                  <div class="h-full bg-primary transition-all" [style.width.%]="pct()"></div>
                </div>
              </div>
            } @else {
              <p hlmCardDescription class="mt-2">No active build steps.</p>
              <a routerLink="/admin/v2/site/editor" hlmBtn variant="primary" size="sm" class="mt-3"
                 data-testid="v2-site-build-cta">Open editor to build →</a>
            }
          </div>
        }
      }
    }
  `,
})
export class V2SiteBuildComponent {
  private readonly api = inject(ApiService);
  protected readonly ctx = inject(V2SiteContextService);

  protected readonly state = toSignal(
    toObservable(this.ctx.selectedSite).pipe(
      switchMap((site) =>
        site
          ? this.api.getWorkflow(site.id).pipe(
              map((r) => ({ status: 'ready', wf: r.data }) as BuildState),
              startWith({ status: 'loading' } as BuildState),
              catchError((e: unknown) =>
                of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as BuildState),
              ),
            )
          : of({ status: 'error', message: 'No site' } as BuildState),
      ),
    ),
    { initialValue: { status: 'loading' } as BuildState },
  );

  protected readonly wf = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.wf : null;
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });
  protected readonly done = computed(() => this.wf()?.steps_completed ?? 0);
  protected readonly total = computed(() => this.wf()?.total_steps ?? 0);
  protected pct(): number {
    const t = this.total();
    return t > 0 ? Math.min(100, Math.round((this.done() / t) * 100)) : 0;
  }

  protected statusVariant(status: string): BadgeVariant {
    const s = (status || '').toLowerCase();
    if (s.includes('publish') || s.includes('complete') || s.includes('done') || s.includes('success')) return 'success';
    if (s.includes('build') || s.includes('generat') || s.includes('run') || s.includes('progress')) return 'info';
    if (s.includes('fail') || s.includes('error')) return 'danger';
    if (s.includes('queue') || s.includes('pending')) return 'warning';
    return 'neutral';
  }

  protected reload(): void {
    location.reload();
  }
}
