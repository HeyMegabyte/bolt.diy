/**
 * @module pages/admin-v2/sections/api-tokens
 *
 * V2 API Tokens section (SYS-ADMIN, org-wide) — the org's API keys via
 * `getApiKeys()` (session-scoped). Each row: name · masked prefix · scope chips
 * · active/revoked/expired badge · last-used + created relative time. Read-only
 * (mint/revoke is a separate POST surface; the plaintext secret is shown once at
 * creation and never returned here — no fake controls). 4-state on helm
 * primitives per [[spartan-ui-design-system]] + [[auth-permissions-security-supervisor]].
 *
 * @example Routed as the `api-tokens` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService, type ApiKey } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';

type KeysState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; keys: ApiKey[] };

@Component({
  selector: 'app-v2-api-tokens',
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
      <h2 class="text-lg font-semibold text-foreground">API Tokens</h2>
      <p class="text-sm text-muted-foreground">Programmatic access keys for your org</p>
    </div>

    @switch (state().status) {
      @case ('loading') {
        <div class="flex flex-col gap-2" data-testid="v2-api-tokens-loading">
          @for (s of [0,1,2]; track s) { <div hlmCard class="h-14 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-api-tokens-error">
          <h3 hlmCardTitle>Couldn't load API tokens</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        @if (keys().length === 0) {
          <div hlmCard class="text-center py-8" data-testid="v2-api-tokens-empty">
            <p hlmCardDescription>No API tokens yet — mint one to access the API programmatically.</p>
          </div>
        } @else {
          <ul hlmCard class="p-0 divide-y divide-border/50" data-testid="v2-api-tokens-list">
            @for (k of keys(); track k.id) {
              <li class="px-3 py-2.5" data-testid="v2-api-tokens-row">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm text-foreground truncate">{{ k.name }}</span>
                  <span class="font-mono text-xs text-muted-foreground shrink-0">{{ k.prefix }}…</span>
                  <span class="flex-1"></span>
                  <span hlmBadge [variant]="keyVariant(k)" class="shrink-0">{{ keyLabel(k) }}</span>
                </div>
                <div class="mt-1.5 flex items-center gap-2 flex-wrap">
                  @for (sc of k.scopes; track sc) {
                    <span hlmBadge variant="neutral" class="font-mono text-[0.65rem]">{{ sc }}</span>
                  }
                  <span class="flex-1"></span>
                  <span class="text-xs text-muted-foreground tabular-nums shrink-0" [title]="k.created_at">
                    {{ k.last_used_at ? 'used' : 'created' }} {{ (k.last_used_at || k.created_at) | relativeDate }}
                  </span>
                </div>
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class V2ApiTokensComponent {
  private readonly api = inject(ApiService);

  protected readonly state = toSignal(
    this.api.getApiKeys().pipe(
      map((r) => ({ status: 'ready', keys: r.data ?? [] }) as KeysState),
      startWith({ status: 'loading' } as KeysState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as KeysState),
      ),
    ),
    { initialValue: { status: 'loading' } as KeysState },
  );

  protected readonly keys = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.keys : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  private expired(k: ApiKey): boolean {
    return !!k.expires_at && new Date(k.expires_at).getTime() < Date.now();
  }
  protected keyLabel(k: ApiKey): string {
    if (k.revoked_at) return 'revoked';
    if (this.expired(k)) return 'expired';
    return 'active';
  }
  protected keyVariant(k: ApiKey): BadgeVariant {
    if (k.revoked_at) return 'danger';
    if (this.expired(k)) return 'warning';
    return 'success';
  }

  protected reload(): void {
    location.reload();
  }
}
