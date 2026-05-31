/**
 * @module pages/admin-v2/sections/site-branches
 *
 * Per-site Branches — a SITE-group section driven by the topbar Project dropdown
 * ({@link V2SiteContextService.selectedSite}): the selected site's branches via
 * `getSiteBranches` — staged edits with an approval gate + a preview URL. Each
 * row: branch_name · status badge · approvals (received/required) · "Preview ↗".
 * Mirrors the legacy site-branches feature. Same dropdown-reactive `switchMap`
 * pattern as Forms/Files/Snapshots. 4-state + no-site state per
 * [[spartan-ui-design-system]].
 *
 * @example Routed as `site/branches` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { ApiService, type SiteBranch } from '../../../services/api.service';
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

type BranchesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: SiteBranch[] };

@Component({
  selector: 'app-v2-site-branches',
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
      <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-site-branches-nosite">
        <h3 hlmCardTitle>No site selected</h3>
        <p hlmCardDescription class="mt-1">Pick a project from the dropdown above to see its branches.</p>
      </div>
    } @else {
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-foreground">Branches</h2>
          <p class="text-sm text-muted-foreground">Staged edits + approvals for {{ ctx.selectedSite()!.business_name }}</p>
        </div>
        <span class="text-sm text-muted-foreground tabular-nums">{{ rows().length }} branch{{ rows().length === 1 ? '' : 'es' }}</span>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <div class="flex flex-col gap-2" data-testid="v2-site-branches-loading">
            @for (s of [0,1]; track s) { <div hlmCard class="h-14 animate-pulse opacity-60"></div> }
          </div>
        }
        @case ('error') {
          <div hlmCard class="max-w-md mx-auto mt-12 text-center" role="alert" data-testid="v2-site-branches-error">
            <h3 hlmCardTitle>Couldn't load branches</h3>
            <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
            <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
          </div>
        }
        @case ('ready') {
          @if (rows().length === 0) {
            <div hlmCard class="text-center py-8" data-testid="v2-site-branches-empty">
              <p hlmCardDescription>No branches — the live site is the only version. Branch from the editor to stage edits.</p>
            </div>
          } @else {
            <ul hlmCard class="p-0 divide-y divide-border/50" data-testid="v2-site-branches-list">
              @for (br of rows(); track br.id) {
                <li class="flex items-center gap-3 px-3 py-2.5 text-sm" data-testid="v2-site-branches-row">
                  <span class="font-mono text-foreground truncate">{{ br.branch_name }}</span>
                  <span hlmBadge [variant]="statusVariant(br.status)" class="shrink-0 capitalize">{{ br.status }}</span>
                  <span class="text-xs text-muted-foreground shrink-0 tabular-nums">{{ br.approvals_received }}/{{ br.approvals_required }} approvals</span>
                  <span class="flex-1"></span>
                  <span class="text-xs text-muted-foreground shrink-0 tabular-nums" [title]="br.created_at">{{ br.created_at | relativeDate }}</span>
                  @if (br.preview_url) {
                    <a [href]="br.preview_url" target="_blank" rel="noopener noreferrer"
                       hlmBtn variant="outline" size="sm" class="shrink-0"
                       [attr.data-testid]="'v2-branch-preview-' + br.id"
                       [attr.aria-label]="'Preview branch ' + br.branch_name">Preview ↗</a>
                  }
                </li>
              }
            </ul>
          }
        }
      }
    }
  `,
})
export class V2SiteBranchesComponent {
  private readonly api = inject(ApiService);
  protected readonly ctx = inject(V2SiteContextService);

  protected readonly state = toSignal(
    toObservable(this.ctx.selectedSite).pipe(
      switchMap((site) =>
        site
          ? this.api.getSiteBranches(site.id).pipe(
              map((r) => ({ status: 'ready', rows: r.branches ?? [] }) as BranchesState),
              startWith({ status: 'loading' } as BranchesState),
              catchError((e: unknown) =>
                of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as BranchesState),
              ),
            )
          : of({ status: 'ready', rows: [] } as BranchesState),
      ),
    ),
    { initialValue: { status: 'loading' } as BranchesState },
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
    switch (status) {
      case 'merged':
        return 'success';
      case 'review':
        return 'warning';
      case 'closed':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  protected reload(): void {
    location.reload();
  }
}
