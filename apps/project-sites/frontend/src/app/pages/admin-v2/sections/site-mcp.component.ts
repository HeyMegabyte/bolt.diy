/**
 * @module pages/admin-v2/sections/site-mcp
 *
 * Per-site MCP Server — a SITE-group section driven by the topbar Project
 * dropdown. The site exposes its OWN MCP server to AI clients; this shows the
 * tools it offers (`getSiteMcpTools`: name · handler · auth · enabled) + recent
 * client calls (`getSiteMcpCalls`: tool · status · latency · time), via
 * `forkJoin`. Distinct from the org-wide MCP *connections* section. Mirrors the
 * legacy site-mcp-server feature. 4-state + no-site state per
 * [[spartan-ui-design-system]].
 *
 * @example Routed as `site/mcp` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, map, of, startWith, switchMap } from 'rxjs';
import { ApiService, type SiteMcpTool, type SiteMcpCall } from '../../../services/api.service';
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

type McpState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tools: SiteMcpTool[]; calls: SiteMcpCall[] };

@Component({
  selector: 'app-v2-site-mcp',
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
      <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-site-mcp-nosite">
        <h3 hlmCardTitle>No site selected</h3>
        <p hlmCardDescription class="mt-1">Pick a project from the dropdown above to see its MCP server.</p>
      </div>
    } @else {
      <div class="mb-3">
        <h2 class="text-lg font-semibold text-foreground">MCP Server</h2>
        <p class="text-sm text-muted-foreground">Tools {{ ctx.selectedSite()!.business_name }} exposes to AI clients</p>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <div class="flex flex-col gap-3" data-testid="v2-site-mcp-loading">
            <div hlmCard class="h-16 animate-pulse opacity-60"></div>
            @for (s of [0,1,2]; track s) { <div hlmCard class="h-12 animate-pulse opacity-60"></div> }
          </div>
        }
        @case ('error') {
          <div hlmCard class="max-w-md mx-auto mt-12 text-center" role="alert" data-testid="v2-site-mcp-error">
            <h3 hlmCardTitle>Couldn't load the MCP server</h3>
            <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
            <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
          </div>
        }
        @case ('ready') {
          <!-- Exposed tools -->
          <div hlmCard class="mb-3" data-testid="v2-site-mcp-tools">
            <h3 hlmCardTitle>Tools</h3>
            @if (tools().length === 0) {
              <p hlmCardDescription class="mt-1">No tools exposed yet — define them in the editor to give AI clients capabilities.</p>
            } @else {
              <ul class="mt-3 flex flex-col gap-2">
                @for (t of tools(); track t.id) {
                  <li class="flex items-center gap-3 text-sm" data-testid="v2-site-mcp-tool">
                    <span class="font-mono text-foreground truncate">{{ t.tool_name }}</span>
                    @if (t.handler_kind) { <span hlmBadge variant="info" class="shrink-0">{{ t.handler_kind }}</span> }
                    @if (t.requires_auth) { <span hlmBadge variant="warning" class="shrink-0">auth</span> }
                    <span class="flex-1"></span>
                    <span hlmBadge [variant]="t.enabled ? 'success' : 'neutral'" class="shrink-0">{{ t.enabled ? 'enabled' : 'off' }}</span>
                  </li>
                }
              </ul>
            }
          </div>

          <!-- Recent calls -->
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-foreground">Recent calls</h3>
            <span class="text-xs text-muted-foreground tabular-nums">{{ calls().length }}</span>
          </div>
          @if (calls().length === 0) {
            <div hlmCard class="text-center py-8" data-testid="v2-site-mcp-calls-empty">
              <p hlmCardDescription>No client calls recorded yet.</p>
            </div>
          } @else {
            <ul hlmCard class="p-0 divide-y divide-border/50 font-mono text-xs" data-testid="v2-site-mcp-calls">
              @for (cl of calls(); track cl.id) {
                <li class="flex items-center gap-3 px-3 py-2" data-testid="v2-site-mcp-call-row">
                  <span hlmBadge [variant]="callVariant(cl.result_status)" class="shrink-0">{{ cl.result_status || '—' }}</span>
                  <span class="flex-1 min-w-0 truncate text-foreground">{{ cl.tool_name }}</span>
                  @if (cl.agent_client_id) { <span class="text-muted-foreground shrink-0 truncate max-w-[14ch]">{{ cl.agent_client_id }}</span> }
                  @if (cl.latency_ms != null) { <span class="text-muted-foreground tabular-nums shrink-0">{{ cl.latency_ms }}ms</span> }
                  <span class="text-muted-foreground shrink-0 tabular-nums" [title]="cl.called_at">{{ cl.called_at | relativeDate }}</span>
                </li>
              }
            </ul>
          }
        }
      }
    }
  `,
})
export class V2SiteMcpComponent {
  private readonly api = inject(ApiService);
  protected readonly ctx = inject(V2SiteContextService);

  protected readonly state = toSignal(
    toObservable(this.ctx.selectedSite).pipe(
      switchMap((site) =>
        site
          ? forkJoin({
              tools: this.api.getSiteMcpTools(site.id),
              calls: this.api.getSiteMcpCalls(site.id).pipe(catchError(() => of({ calls: [] as SiteMcpCall[] }))),
            }).pipe(
              map((r) => ({ status: 'ready', tools: r.tools.tools ?? [], calls: r.calls.calls ?? [] }) as McpState),
              startWith({ status: 'loading' } as McpState),
              catchError((e: unknown) =>
                of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as McpState),
              ),
            )
          : of({ status: 'ready', tools: [], calls: [] } as McpState),
      ),
    ),
    { initialValue: { status: 'loading' } as McpState },
  );

  protected readonly tools = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.tools : [];
  });
  protected readonly calls = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.calls : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected callVariant(status: string | null | undefined): BadgeVariant {
    const s = (status || '').toLowerCase();
    if (s.includes('ok') || s.includes('success') || s === '200') return 'success';
    if (s.includes('error') || s.includes('fail') || s.startsWith('5') || s.startsWith('4')) return 'danger';
    return 'neutral';
  }

  protected reload(): void {
    location.reload();
  }
}
