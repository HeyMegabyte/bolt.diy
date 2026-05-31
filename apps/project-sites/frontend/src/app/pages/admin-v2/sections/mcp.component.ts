/**
 * @module pages/admin-v2/sections/mcp
 *
 * V2 MCP section (SYS-ADMIN, org-wide) — the org's MCP connections across all
 * sites via `getMcpConnections()` (new session-scoped worker route; safe columns
 * only, never tokens). Each row: provider · display name · status dot/badge ·
 * scope chips · expiry · connected-relative-time. Read-only (connect/disconnect
 * is the per-site OAuth surface). 4-state on helm primitives per
 * [[spartan-ui-design-system]] + [[auth-permissions-security-supervisor]].
 *
 * @example Routed as the `mcp` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService, type McpConnection } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';

type McpState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: McpConnection[] };

@Component({
  selector: 'app-v2-mcp',
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
      <h2 class="text-lg font-semibold text-foreground">MCP</h2>
      <p class="text-sm text-muted-foreground">Connected provider integrations across your sites</p>
    </div>

    @switch (state().status) {
      @case ('loading') {
        <div class="flex flex-col gap-2" data-testid="v2-mcp-loading">
          @for (s of [0,1,2]; track s) { <div hlmCard class="h-14 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-mcp-error">
          <h3 hlmCardTitle>Couldn't load MCP connections</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        @if (rows().length === 0) {
          <div hlmCard class="text-center py-8" data-testid="v2-mcp-empty">
            <p hlmCardDescription>No integrations connected yet — connect a provider from a site's editor.</p>
          </div>
        } @else {
          <ul hlmCard class="p-0 divide-y divide-border/50" data-testid="v2-mcp-list">
            @for (mc of rows(); track mc.id) {
              <li class="px-3 py-2.5" data-testid="v2-mcp-row">
                <div class="flex items-center gap-2">
                  <span class="h-1.5 w-1.5 rounded-full shrink-0" [class]="dotClass(mc.status)" aria-hidden="true"></span>
                  <span class="font-medium text-sm text-foreground capitalize truncate">{{ mc.provider }}</span>
                  @if (mc.display_name && mc.display_name !== mc.provider) {
                    <span class="text-xs text-muted-foreground truncate">{{ mc.display_name }}</span>
                  }
                  <span class="flex-1"></span>
                  <span hlmBadge [variant]="statusVariant(mc.status)" class="shrink-0">{{ mc.status }}</span>
                </div>
                <div class="mt-1.5 flex items-center gap-2 flex-wrap">
                  @for (sc of mc.scopes.slice(0, 6); track sc) {
                    <span hlmBadge variant="neutral" class="font-mono text-[0.65rem]">{{ sc }}</span>
                  }
                  @if (mc.scopes.length > 6) { <span class="text-[0.65rem] text-muted-foreground">+{{ mc.scopes.length - 6 }}</span> }
                  <span class="flex-1"></span>
                  @if (mc.token_expires_at) {
                    <span class="text-xs shrink-0" [class]="expired(mc) ? 'text-[#ff7d96]' : 'text-muted-foreground'" [title]="mc.token_expires_at">
                      {{ expired(mc) ? 'expired' : 'expires' }} {{ mc.token_expires_at | relativeDate }}
                    </span>
                  }
                  <span class="text-xs text-muted-foreground tabular-nums shrink-0" [title]="mc.connected_at">connected {{ mc.connected_at | relativeDate }}</span>
                </div>
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class V2McpComponent {
  private readonly api = inject(ApiService);

  protected readonly state = toSignal(
    this.api.getMcpConnections().pipe(
      map((r) => ({ status: 'ready', rows: r.data ?? [] }) as McpState),
      startWith({ status: 'loading' } as McpState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as McpState),
      ),
    ),
    { initialValue: { status: 'loading' } as McpState },
  );

  protected readonly rows = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.rows : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected expired(mc: McpConnection): boolean {
    return !!mc.token_expires_at && new Date(mc.token_expires_at).getTime() < Date.now();
  }

  protected dotClass(status: string): string {
    const s = (status || '').toLowerCase();
    if (s.includes('revoked') || s.includes('error')) return 'bg-[#ff4d6d]';
    if (s.includes('expired')) return 'bg-[#ffd166]';
    return 'bg-[#4dffb5]';
  }
  protected statusVariant(status: string): BadgeVariant {
    const s = (status || '').toLowerCase();
    if (s.includes('active') || s.includes('connected')) return 'success';
    if (s.includes('revoked') || s.includes('error')) return 'danger';
    if (s.includes('expired')) return 'warning';
    return 'neutral';
  }

  protected reload(): void {
    location.reload();
  }
}
