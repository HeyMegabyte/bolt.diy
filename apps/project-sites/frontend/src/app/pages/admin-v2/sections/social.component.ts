/**
 * @module pages/admin-v2/sections/social
 *
 * V2 Social section (SYS-ADMIN, org-wide) — connected social accounts +
 * scheduled/published posts via `forkJoin([getSocialAccounts, getSocialPosts])`.
 * Org-scoped (no Project-dropdown dependency). Top strip = account chips
 * (platform · handle · status); below = a recent-posts feed (status badge ·
 * content preview · scheduled/published relative time). 4-state on helm
 * primitives per [[spartan-ui-design-system]] + [[angular-large-app-supervisor]].
 *
 * @example Routed as the `social` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, map, of, startWith } from 'rxjs';
import { ApiService, type SocialAccount, type SocialPost } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';

type SocialState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; accounts: SocialAccount[]; posts: SocialPost[] };

@Component({
  selector: 'app-v2-social',
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
      <h2 class="text-lg font-semibold text-foreground">Social</h2>
      <p class="text-sm text-muted-foreground">Connected accounts &amp; scheduled posts</p>
    </div>

    @switch (state().status) {
      @case ('loading') {
        <div class="flex flex-col gap-3" data-testid="v2-social-loading">
          <div hlmCard class="h-16 animate-pulse opacity-60"></div>
          @for (s of [0,1,2]; track s) { <div hlmCard class="h-14 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-social-error">
          <h3 hlmCardTitle>Couldn't load social</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        <!-- Connected accounts strip -->
        <div hlmCard class="mb-3" data-testid="v2-social-accounts">
          <h3 hlmCardTitle>Accounts</h3>
          @if (accounts().length === 0) {
            <p hlmCardDescription class="mt-1">No social accounts connected yet.</p>
          } @else {
            <div class="mt-3 flex flex-wrap gap-2">
              @for (acc of accounts(); track acc.id) {
                <span class="inline-flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 text-xs"
                      data-testid="v2-social-account">
                  <span class="h-1.5 w-1.5 rounded-full shrink-0" [class]="dotClass(acc.status)" aria-hidden="true"></span>
                  <span class="font-medium text-foreground">{{ acc.platform }}</span>
                  @if (acc.handle) { <span class="text-muted-foreground truncate max-w-[12ch]">{{ '@' + acc.handle }}</span> }
                </span>
              }
            </div>
          }
        </div>

        <!-- Recent posts feed -->
        <div class="mb-2 flex items-center justify-between gap-3">
          <h3 class="text-sm font-semibold text-foreground">Recent posts</h3>
          <span class="text-xs text-muted-foreground tabular-nums">{{ posts().length }}</span>
        </div>
        @if (posts().length === 0) {
          <div hlmCard class="text-center py-8" data-testid="v2-social-posts-empty">
            <p hlmCardDescription>No posts scheduled or published yet.</p>
          </div>
        } @else {
          <ul hlmCard class="p-0 divide-y divide-border/50" data-testid="v2-social-posts">
            @for (post of posts(); track post.id) {
              <li class="flex items-start gap-3 px-3 py-2.5 text-sm" data-testid="v2-social-post-row">
                <span hlmBadge [variant]="statusVariant(post.status)" class="shrink-0 mt-0.5">{{ post.status || 'draft' }}</span>
                <div class="flex-1 min-w-0">
                  <p class="text-foreground line-clamp-2">{{ post.content || '(no content)' }}</p>
                  @if (post.hashtags) { <p class="text-xs text-primary/70 truncate">{{ post.hashtags }}</p> }
                </div>
                <span class="text-xs text-muted-foreground shrink-0 tabular-nums" [title]="postWhen(post)">{{ postWhen(post) | relativeDate }}</span>
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class V2SocialComponent {
  private readonly api = inject(ApiService);

  protected readonly state = toSignal(
    forkJoin({
      accounts: this.api.getSocialAccounts(),
      posts: this.api.getSocialPosts(50),
    }).pipe(
      map((r) => ({ status: 'ready', accounts: r.accounts.data ?? [], posts: r.posts.data ?? [] }) as SocialState),
      startWith({ status: 'loading' } as SocialState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as SocialState),
      ),
    ),
    { initialValue: { status: 'loading' } as SocialState },
  );

  protected readonly accounts = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.accounts : [];
  });
  protected readonly posts = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.posts : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected postWhen(post: SocialPost): string {
    return post.published_at || post.scheduled_at || post.created_at;
  }

  protected dotClass(status: string | null | undefined): string {
    const s = (status || '').toLowerCase();
    if (s.includes('active') || s.includes('connected') || s.includes('ok')) return 'bg-[#4dffb5]';
    if (s.includes('error') || s.includes('expired') || s.includes('revoked')) return 'bg-[#ff4d6d]';
    if (s.includes('pending') || s.includes('expiring')) return 'bg-[#ffd166]';
    return 'bg-muted-foreground/50';
  }

  protected statusVariant(status: string | null | undefined): BadgeVariant {
    const s = (status || '').toLowerCase();
    if (s.includes('publish') || s.includes('posted') || s.includes('sent')) return 'success';
    if (s.includes('fail') || s.includes('error')) return 'danger';
    if (s.includes('schedul') || s.includes('queue') || s.includes('pending')) return 'warning';
    if (s.includes('draft')) return 'neutral';
    return 'info';
  }

  protected reload(): void {
    location.reload();
  }
}
