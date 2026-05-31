/**
 * @module pages/admin-v2/sections/content-freshness
 *
 * V2 Content Freshness (SYS-ADMIN, org-wide) — mirrors the legacy feature: the
 * platform watches engagement (dwell, idle days) and the AI drafts rewrites for
 * stale sections. This lists pending drafts via `getContentFreshness()`: which
 * site + section, how stale (idle days), avg dwell, the model, status. Approve/
 * reject is a per-draft POST surface (links to classic admin for now — no fake
 * controls). 4-state on helm primitives per [[spartan-ui-design-system]].
 *
 * @example Routed as the `content-freshness` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService, type ContentDraft } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';

type FreshState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; drafts: ContentDraft[]; total: number };

@Component({
  selector: 'app-v2-content-freshness',
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
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-foreground">Content Freshness</h2>
      <p class="text-sm text-muted-foreground">AI rewrite drafts for stale sections, by engagement signal</p>
    </div>

    @switch (state().status) {
      @case ('loading') {
        <div class="flex flex-col gap-2" data-testid="v2-freshness-loading">
          @for (s of [0,1,2]; track s) { <div hlmCard class="h-14 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-freshness-error">
          <h3 hlmCardTitle>Couldn't load content freshness</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        @if (drafts().length === 0) {
          <div hlmCard class="text-center py-8" data-testid="v2-freshness-empty">
            <p hlmCardDescription>No pending rewrites — your content is fresh.</p>
          </div>
        } @else {
          <ul hlmCard class="p-0 divide-y divide-border/50" data-testid="v2-freshness-list">
            @for (d of drafts(); track d.id) {
              <li class="flex items-center gap-3 px-3 py-2.5 text-sm" data-testid="v2-freshness-row">
                <span class="font-mono text-foreground truncate">{{ d.section_key }}</span>
                @if (d.idle_days != null) { <span hlmBadge [variant]="staleVariant(d.idle_days)" class="shrink-0">{{ d.idle_days }}d idle</span> }
                @if (d.ai_model) { <span class="text-xs text-muted-foreground shrink-0">{{ d.ai_model }}</span> }
                <span class="flex-1"></span>
                @if (d.dwell_seconds_avg != null) { <span class="text-xs text-muted-foreground tabular-nums shrink-0">{{ dwell(d.dwell_seconds_avg) }} dwell</span> }
                <span hlmBadge variant="warning" class="shrink-0">{{ d.status }}</span>
                <span class="text-xs text-muted-foreground shrink-0 tabular-nums" [title]="d.created_at">{{ d.created_at | relativeDate }}</span>
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class V2ContentFreshnessComponent {
  private readonly api = inject(ApiService);

  protected readonly state = toSignal(
    this.api.getContentFreshness('pending').pipe(
      map((r) => ({ status: 'ready', drafts: r.drafts ?? [], total: r.total ?? 0 }) as FreshState),
      startWith({ status: 'loading' } as FreshState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as FreshState),
      ),
    ),
    { initialValue: { status: 'loading' } as FreshState },
  );

  protected readonly drafts = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.drafts : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected dwell(secs: number): string {
    return secs < 60 ? `${Math.round(secs)}s` : `${Math.round(secs / 60)}m`;
  }
  protected staleVariant(idleDays: number): BadgeVariant {
    if (idleDays >= 90) return 'danger';
    if (idleDays >= 30) return 'warning';
    return 'neutral';
  }

  protected reload(): void {
    location.reload();
  }
}
