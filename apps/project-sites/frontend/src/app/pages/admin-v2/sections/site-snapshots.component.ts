/**
 * @module pages/admin-v2/sections/site-snapshots
 *
 * Per-site Snapshots — a SITE-group section driven by the topbar Project
 * dropdown ({@link V2SiteContextService.selectedSite}): the selected site's
 * version history via `getSnapshots` (name / description / relative time /
 * a "View frozen" link to `{slug}-{snapshot}.projectsites.dev` + optional PR
 * link). Same dropdown-reactive `switchMap` pattern as Forms/Files/Domains.
 * 4-state + no-site state on helm primitives per [[spartan-ui-design-system]].
 *
 * @example Routed as `site/snapshots` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { ApiService, type Snapshot } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';
import { V2SiteContextService } from '../v2-site-context.service';

type SnapshotsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: Snapshot[] };

@Component({
  selector: 'app-v2-site-snapshots',
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
      <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-site-snapshots-nosite">
        <h3 hlmCardTitle>No site selected</h3>
        <p hlmCardDescription class="mt-1">Pick a project from the dropdown above to see its version history.</p>
      </div>
    } @else {
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-foreground">Snapshots</h2>
          <p class="text-sm text-muted-foreground">Frozen versions of {{ ctx.selectedSite()!.business_name }}</p>
        </div>
        <span class="text-sm text-muted-foreground tabular-nums">{{ rows().length }} version{{ rows().length === 1 ? '' : 's' }}</span>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <div class="flex flex-col gap-2" data-testid="v2-site-snapshots-loading">
            @for (s of [0,1,2]; track s) { <div hlmCard class="h-14 animate-pulse opacity-60"></div> }
          </div>
        }
        @case ('error') {
          <div hlmCard class="max-w-md mx-auto mt-12 text-center" role="alert" data-testid="v2-site-snapshots-error">
            <h3 hlmCardTitle>Couldn't load snapshots</h3>
            <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
            <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
          </div>
        }
        @case ('ready') {
          @if (rows().length === 0) {
            <div hlmCard class="text-center py-8" data-testid="v2-site-snapshots-empty">
              <p hlmCardDescription>No snapshots yet — one is frozen automatically on every build &amp; edit.</p>
            </div>
          } @else {
            <ul hlmCard class="p-0 divide-y divide-border/50" data-testid="v2-site-snapshots-list">
              @for (snap of rows(); track snap.id) {
                <li class="flex items-center gap-3 px-3 py-2.5 text-sm" data-testid="v2-site-snapshots-row">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-foreground truncate">{{ snap.snapshot_name }}</span>
                      @if (snap.github_pr_number) {
                        <span hlmBadge variant="info" class="shrink-0">PR #{{ snap.github_pr_number }}</span>
                      }
                    </div>
                    @if (snap.description) {
                      <p class="text-xs text-muted-foreground truncate">{{ snap.description }}</p>
                    }
                  </div>
                  <span class="text-xs text-muted-foreground shrink-0 tabular-nums" [title]="snap.created_at">{{ snap.created_at | relativeDate }}</span>
                  @if (snap.github_pr_html_url) {
                    <a [href]="snap.github_pr_html_url" target="_blank" rel="noopener noreferrer"
                       hlmBtn variant="ghost" size="sm" class="shrink-0" aria-label="Open pull request">PR ↗</a>
                  }
                  <a [href]="frozenUrl(snap)" target="_blank" rel="noopener noreferrer"
                     hlmBtn variant="outline" size="sm" class="shrink-0"
                     [attr.data-testid]="'v2-snapshot-view-' + snap.id"
                     [attr.aria-label]="'View frozen version ' + snap.snapshot_name">View ↗</a>
                </li>
              }
            </ul>
          }
        }
      }
    }
  `,
})
export class V2SiteSnapshotsComponent {
  private readonly api = inject(ApiService);
  protected readonly ctx = inject(V2SiteContextService);

  protected readonly state = toSignal(
    toObservable(this.ctx.selectedSite).pipe(
      switchMap((site) =>
        site
          ? this.api.getSnapshots(site.id).pipe(
              map((r) => ({ status: 'ready', rows: r.data ?? [] }) as SnapshotsState),
              startWith({ status: 'loading' } as SnapshotsState),
              catchError((e: unknown) =>
                of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as SnapshotsState),
              ),
            )
          : of({ status: 'ready', rows: [] } as SnapshotsState),
      ),
    ),
    { initialValue: { status: 'loading' } as SnapshotsState },
  );

  protected readonly rows = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.rows : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  /** Frozen versions serve at `{slug}-{snapshot-name}.projectsites.dev`. */
  protected frozenUrl(snap: Snapshot): string {
    const slug = this.ctx.selectedSite()?.slug ?? '';
    const name = (snap.snapshot_name || 'initial').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return `https://${slug}-${name}.projectsites.dev`;
  }

  protected reload(): void {
    location.reload();
  }
}
