/**
 * @module pages/admin-v2/sections/site-domains
 *
 * Per-site Domains — a SITE-group section driven by the topbar Project dropdown
 * ({@link V2SiteContextService.selectedSite}): the selected site's hostnames
 * via `getHostnames` (hostname / status badge / ★ primary). Distinct from the
 * SYS-ADMIN org-wide Domains view. Same dropdown-reactive pattern as Forms/Files.
 * 4-state + no-site state on helm primitives per [[spartan-ui-design-system]].
 *
 * @example Routed as `site/domains` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { ApiService, type Hostname } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { V2SiteContextService } from '../v2-site-context.service';

type DomainsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: Hostname[] };

@Component({
  selector: 'app-v2-site-domains',
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
      <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-site-domains-nosite">
        <h3 hlmCardTitle>No site selected</h3>
        <p hlmCardDescription class="mt-1">Pick a project from the dropdown above to manage its domains.</p>
      </div>
    } @else {
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-foreground">Domains</h2>
          <p class="text-sm text-muted-foreground">{{ ctx.selectedSite()!.business_name }}</p>
        </div>
        <span class="text-sm text-muted-foreground tabular-nums">{{ ctx.selectedSite()!.slug }}.projectsites.dev</span>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <div class="flex flex-col gap-2" data-testid="v2-site-domains-loading">
            @for (s of [0,1]; track s) { <div hlmCard class="h-12 animate-pulse opacity-60"></div> }
          </div>
        }
        @case ('error') {
          <div hlmCard class="max-w-md mx-auto mt-12 text-center" role="alert" data-testid="v2-site-domains-error">
            <h3 hlmCardTitle>Couldn't load domains</h3>
            <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
            <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
          </div>
        }
        @case ('ready') {
          @if (rows().length === 0) {
            <div hlmCard class="text-center py-8" data-testid="v2-site-domains-empty">
              <p hlmCardDescription>No custom domains — this site serves at its free subdomain.</p>
              <a routerLink="/admin/v2/domains" hlmBtn variant="primary" size="sm" class="mt-3"
                 data-testid="v2-site-domains-cta">Connect a domain →</a>
            </div>
          } @else {
            <ul hlmCard class="p-0 divide-y divide-border/50" data-testid="v2-site-domains-list">
              @for (h of rows(); track h.id) {
                <li class="flex items-center gap-3 px-3 py-2 text-sm" data-testid="v2-site-domains-row">
                  <span class="flex-1 min-w-0 truncate text-foreground">{{ h.hostname }}</span>
                  @if (h.is_primary) { <span hlmBadge variant="info" class="shrink-0">primary</span> }
                  <span hlmBadge [variant]="statusVariant(h.status)" class="shrink-0">{{ h.status }}</span>
                </li>
              }
            </ul>
          }
        }
      }
    }
  `,
})
export class V2SiteDomainsComponent {
  private readonly api = inject(ApiService);
  protected readonly ctx = inject(V2SiteContextService);

  protected readonly state = toSignal(
    toObservable(this.ctx.selectedSite).pipe(
      switchMap((site) =>
        site
          ? this.api.getHostnames(site.id).pipe(
              map((r) => ({ status: 'ready', rows: r.data ?? [] }) as DomainsState),
              startWith({ status: 'loading' } as DomainsState),
              catchError((e: unknown) =>
                of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as DomainsState),
              ),
            )
          : of({ status: 'ready', rows: [] } as DomainsState),
      ),
    ),
    { initialValue: { status: 'loading' } as DomainsState },
  );

  protected readonly rows = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.rows : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected statusVariant(status: string): BadgeVariant {
    const s = (status || '').toLowerCase();
    if (s.includes('active') || s.includes('verified')) return 'success';
    if (s.includes('pending') || s.includes('verifying')) return 'warning';
    if (s.includes('fail') || s.includes('error')) return 'danger';
    return 'neutral';
  }

  protected reload(): void {
    location.reload();
  }
}
