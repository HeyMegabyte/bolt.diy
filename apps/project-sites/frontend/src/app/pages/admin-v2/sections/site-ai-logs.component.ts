/**
 * @module pages/admin-v2/sections/site-ai-logs
 *
 * Per-site AI Logs — a SITE-group section driven by the topbar Project dropdown
 * ({@link V2SiteContextService.selectedSite}): the selected site's LLM/tool
 * trace rows via `getAiLogs` (kind · endpoint/model · status · latency · tokens
 * · relative time, with output preview / error as muted subtext). A dev-console
 * feed with a client-side kind filter. Same dropdown-reactive `switchMap`
 * pattern as Forms/Files/Domains/Snapshots. 4-state + no-site state on helm
 * primitives per [[spartan-ui-design-system]] + [[observability-ops-supervisor]].
 *
 * @example Routed as `site/ai-logs` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { ApiService, type AiLogRow } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmInputDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';
import { V2SiteContextService } from '../v2-site-context.service';

type AiLogsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: AiLogRow[] };

@Component({
  selector: 'app-v2-site-ai-logs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmInputDirective,
    HlmBadgeDirective,
    RelativeDatePipe,
  ],
  template: `
    @if (!ctx.selectedSite()) {
      <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-site-ai-logs-nosite">
        <h3 hlmCardTitle>No site selected</h3>
        <p hlmCardDescription class="mt-1">Pick a project from the dropdown above to see its AI activity.</p>
      </div>
    } @else {
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-foreground">AI Logs</h2>
          <p class="text-sm text-muted-foreground">LLM &amp; tool calls for {{ ctx.selectedSite()!.business_name }}</p>
        </div>
        <span class="text-sm text-muted-foreground tabular-nums">{{ filtered().length }} of {{ rows().length }}</span>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <div class="flex flex-col gap-2" data-testid="v2-site-ai-logs-loading">
            @for (s of [0,1,2,3]; track s) { <div hlmCard class="h-12 animate-pulse opacity-60"></div> }
          </div>
        }
        @case ('error') {
          <div hlmCard class="max-w-md mx-auto mt-12 text-center" role="alert" data-testid="v2-site-ai-logs-error">
            <h3 hlmCardTitle>Couldn't load AI logs</h3>
            <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
            <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
          </div>
        }
        @case ('ready') {
          @if (rows().length === 0) {
            <div hlmCard class="text-center py-8" data-testid="v2-site-ai-logs-empty">
              <p hlmCardDescription>No AI activity recorded yet — calls appear here as forms &amp; tools run.</p>
            </div>
          } @else {
            <div class="mb-3">
              <input hlmInput class="max-w-xs h-8" placeholder="Filter by kind, model, endpoint…"
                     [value]="filter()" (input)="onFilter($event)" data-testid="v2-site-ai-logs-filter"
                     aria-label="Filter AI logs" />
            </div>
            @if (filtered().length === 0) {
              <div hlmCard class="text-center py-6" data-testid="v2-site-ai-logs-nomatch">
                <p hlmCardDescription>No entries match your filter.</p>
              </div>
            } @else {
              <ul hlmCard class="p-0 divide-y divide-border/50 font-mono text-xs" data-testid="v2-site-ai-logs-list">
                @for (log of filtered(); track log.id) {
                  <li class="px-3 py-2" data-testid="v2-site-ai-logs-row">
                    <div class="flex items-center gap-2">
                      <span hlmBadge [variant]="statusVariant(log.status)" class="shrink-0">{{ log.status || '—' }}</span>
                      <span class="text-foreground truncate">{{ log.trace_kind || 'call' }}</span>
                      @if (log.endpoint_slug) { <span class="text-muted-foreground truncate">· {{ log.endpoint_slug }}</span> }
                      @if (log.model) { <span class="text-primary/80 truncate">· {{ log.model }}</span> }
                      <span class="flex-1"></span>
                      @if (log.latency_ms != null) { <span class="text-muted-foreground tabular-nums shrink-0">{{ log.latency_ms }}ms</span> }
                      @if (tokens(log); as t) { <span class="text-muted-foreground tabular-nums shrink-0">{{ t }}tok</span> }
                      <span class="text-muted-foreground shrink-0 tabular-nums" [title]="log.created_at">{{ log.created_at | relativeDate }}</span>
                    </div>
                    @if (log.error_message) {
                      <p class="mt-1 text-[#ff7d96] truncate">{{ log.error_message }}</p>
                    } @else if (log.output_preview) {
                      <p class="mt-1 text-muted-foreground/80 truncate">{{ log.output_preview }}</p>
                    }
                  </li>
                }
              </ul>
            }
          }
        }
      }
    }
  `,
})
export class V2SiteAiLogsComponent {
  private readonly api = inject(ApiService);
  protected readonly ctx = inject(V2SiteContextService);
  protected readonly filter = signal('');

  protected readonly state = toSignal(
    toObservable(this.ctx.selectedSite).pipe(
      switchMap((site) =>
        site
          ? this.api.getAiLogs(site.id).pipe(
              map((r) => ({ status: 'ready', rows: r.data ?? [] }) as AiLogsState),
              startWith({ status: 'loading' } as AiLogsState),
              catchError((e: unknown) =>
                of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as AiLogsState),
              ),
            )
          : of({ status: 'ready', rows: [] } as AiLogsState),
      ),
    ),
    { initialValue: { status: 'loading' } as AiLogsState },
  );

  protected readonly rows = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.rows : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });
  protected readonly filtered = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) return this.rows();
    return this.rows().filter((r) =>
      [r.trace_kind, r.model, r.endpoint_slug, r.status, r.tool_name]
        .some((v) => (v ?? '').toLowerCase().includes(q)),
    );
  });

  protected onFilter(e: Event): void {
    this.filter.set((e.target as HTMLInputElement).value);
  }

  /** Combined token count for the row, or null when neither side is set. */
  protected tokens(log: AiLogRow): number | null {
    const sum = (log.tokens_input ?? 0) + (log.tokens_output ?? 0);
    return sum > 0 ? sum : null;
  }

  protected statusVariant(status: string | null | undefined): BadgeVariant {
    const s = (status || '').toLowerCase();
    if (s.includes('ok') || s.includes('success') || s.includes('complete')) return 'success';
    if (s.includes('fail') || s.includes('error')) return 'danger';
    if (s.includes('pending') || s.includes('running')) return 'warning';
    return 'neutral';
  }

  protected reload(): void {
    location.reload();
  }
}
