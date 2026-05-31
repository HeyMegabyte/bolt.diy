/**
 * @module pages/admin-v2/sections/site-ai-endpoints
 *
 * Per-site AI Endpoints — a SITE-group section driven by the topbar Project
 * dropdown ({@link V2SiteContextService.selectedSite}): the selected site's
 * user-defined AI-backed API routes via `getAiEndpoints` (method · slug ·
 * kind · language · enabled/deploy badge · relative time). Same dropdown-
 * reactive `switchMap` pattern as Forms/Files/Snapshots/AI-Logs. 4-state +
 * no-site state on helm primitives per [[spartan-ui-design-system]].
 *
 * @example Routed as `site/ai-endpoints` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { ApiService, type AiEndpointRow } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';
import { V2SiteContextService } from '../v2-site-context.service';

type EndpointsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: AiEndpointRow[] };

@Component({
  selector: 'app-v2-site-ai-endpoints',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmBadgeDirective,
    RelativeDatePipe,
  ],
  template: `
    @if (!ctx.selectedSite()) {
      <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-site-ai-endpoints-nosite">
        <h3 hlmCardTitle>No site selected</h3>
        <p hlmCardDescription class="mt-1">Pick a project from the dropdown above to see its AI endpoints.</p>
      </div>
    } @else {
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-foreground">AI Endpoints</h2>
          <p class="text-sm text-muted-foreground">Custom AI-backed API routes for {{ ctx.selectedSite()!.business_name }}</p>
        </div>
        <span class="text-sm text-muted-foreground tabular-nums">{{ rows().length }} endpoint{{ rows().length === 1 ? '' : 's' }}</span>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="v2-site-ai-endpoints-loading">
            @for (s of [0,1,2,3]; track s) { <div hlmCard class="h-20 animate-pulse opacity-60"></div> }
          </div>
        }
        @case ('error') {
          <div hlmCard class="max-w-md mx-auto mt-12 text-center" role="alert" data-testid="v2-site-ai-endpoints-error">
            <h3 hlmCardTitle>Couldn't load AI endpoints</h3>
            <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
            <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
          </div>
        }
        @case ('ready') {
          @if (rows().length === 0) {
            <div hlmCard class="text-center py-8" data-testid="v2-site-ai-endpoints-empty">
              <p hlmCardDescription>No AI endpoints yet — define one in the editor to expose a custom AI-backed route.</p>
            </div>
          } @else {
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="v2-site-ai-endpoints-grid">
              @for (ep of rows(); track ep.id) {
                <div hlmCard data-testid="v2-site-ai-endpoints-card">
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <span hlmBadge variant="neutral" class="shrink-0 font-mono">{{ (ep.method || 'GET') }}</span>
                      <h4 class="text-sm font-medium text-foreground truncate">{{ ep.display_name || ep.endpoint_slug }}</h4>
                    </div>
                    <span hlmBadge [variant]="deployVariant(ep)" class="shrink-0">{{ deployLabel(ep) }}</span>
                  </div>
                  <p class="mt-1 font-mono text-xs text-muted-foreground truncate">/{{ ep.endpoint_slug }}</p>
                  @if (ep.description) {
                    <p hlmCardDescription class="mt-1 text-xs line-clamp-2">{{ ep.description }}</p>
                  }
                  <div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    @if (ep.kind) { <span hlmBadge variant="info">{{ ep.kind }}</span> }
                    @if (lang(ep); as l) { <span hlmBadge variant="neutral">{{ l }}</span> }
                    <span class="flex-1"></span>
                    <span class="tabular-nums" [title]="ep.created_at">{{ ep.created_at | relativeDate }}</span>
                  </div>
                </div>
              }
            </div>
          }
        }
      }
    }
  `,
})
export class V2SiteAiEndpointsComponent {
  private readonly api = inject(ApiService);
  protected readonly ctx = inject(V2SiteContextService);

  protected readonly state = toSignal(
    toObservable(this.ctx.selectedSite).pipe(
      switchMap((site) =>
        site
          ? this.api.getAiEndpoints(site.id).pipe(
              map((r) => ({ status: 'ready', rows: r.data ?? [] }) as EndpointsState),
              startWith({ status: 'loading' } as EndpointsState),
              catchError((e: unknown) =>
                of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as EndpointsState),
              ),
            )
          : of({ status: 'ready', rows: [] } as EndpointsState),
      ),
    ),
    { initialValue: { status: 'loading' } as EndpointsState },
  );

  protected readonly rows = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.rows : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected lang(ep: AiEndpointRow): string | null {
    return ep.language || ep.worker_language || null;
  }

  /** Disabled wins over deploy_status for the badge. */
  protected deployLabel(ep: AiEndpointRow): string {
    if (ep.enabled === 0 || ep.enabled === false) return 'disabled';
    return ep.deploy_status || (ep.deployed_at ? 'deployed' : 'draft');
  }

  protected deployVariant(ep: AiEndpointRow): BadgeVariant {
    if (ep.enabled === 0 || ep.enabled === false) return 'neutral';
    const s = (ep.deploy_status || (ep.deployed_at ? 'deployed' : 'draft')).toLowerCase();
    if (s.includes('deploy') || s.includes('live') || s.includes('active')) return 'success';
    if (s.includes('fail') || s.includes('error')) return 'danger';
    if (s.includes('pending') || s.includes('deploying')) return 'warning';
    return 'neutral';
  }

  protected reload(): void {
    location.reload();
  }
}
