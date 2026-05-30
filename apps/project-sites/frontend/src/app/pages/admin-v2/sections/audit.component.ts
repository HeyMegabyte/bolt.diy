/**
 * @module pages/admin-v2/sections/audit
 *
 * V2 Audit section — the org activity feed. Reads `GET /api/audit-logs` (org
 * scoped, newest first), rendering action badges + message + relative time
 * (dayjs pipe) with a quick client-side filter. Operators use this to see who
 * did what (publishes, domain changes, billing, auth). 4-state on helm
 * primitives per [[spartan-ui-design-system]] + [[angular-large-app-supervisor]].
 *
 * @example Routed as the `audit` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService } from '../../../services/api.service';
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

interface AuditRow {
  id: string;
  action: string;
  message: string;
  actor_id: string | null;
  target_type: string | null;
  created_at: string;
}

type AuditState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: AuditRow[] };

@Component({
  selector: 'app-v2-audit',
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
    @switch (state().status) {
      @case ('loading') {
        <div class="flex flex-col gap-2" data-testid="v2-audit-loading">
          @for (s of [0,1,2,3,4]; track s) { <div hlmCard class="h-12 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-audit-error">
          <h3 hlmCardTitle>Couldn't load audit log</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        <div class="flex items-center justify-between gap-3 mb-3">
          <input hlmInput class="max-w-xs h-8" placeholder="Filter activity…"
                 [value]="filter()" (input)="onFilter($event)" data-testid="v2-audit-filter"
                 aria-label="Filter audit log by action or message" />
          <span class="text-xs text-muted-foreground tabular-nums">{{ filtered().length }} of {{ rows().length }}</span>
        </div>
        @if (filtered().length === 0) {
          <div hlmCard class="text-center py-8" data-testid="v2-audit-empty">
            <p hlmCardDescription>{{ rows().length === 0 ? 'No activity recorded yet.' : 'No entries match your filter.' }}</p>
          </div>
        } @else {
          <ul hlmCard class="p-0 divide-y divide-border/50" data-testid="v2-audit-list">
            @for (r of filtered(); track r.id) {
              <li class="flex items-center gap-3 px-3 py-2 text-sm" data-testid="v2-audit-row">
                <span hlmBadge [variant]="actionVariant(r.action)" class="shrink-0">{{ shortAction(r.action) }}</span>
                <span class="flex-1 min-w-0 truncate text-foreground">{{ r.message || r.action }}</span>
                @if (r.target_type) { <span class="text-xs text-muted-foreground shrink-0">{{ r.target_type }}</span> }
                <span class="text-xs text-muted-foreground shrink-0 tabular-nums" [title]="r.created_at">{{ r.created_at | relativeDate }}</span>
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class V2AuditComponent {
  private readonly api = inject(ApiService);
  protected readonly filter = signal('');

  protected readonly state = toSignal(
    this.api.get<{ data: AuditRow[] }>('/audit-logs', { limit: '200' }).pipe(
      map((res) => ({ status: 'ready', rows: res.data ?? [] }) as AuditState),
      startWith({ status: 'loading' } as AuditState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as AuditState),
      ),
    ),
    { initialValue: { status: 'loading' } as AuditState },
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
    return this.rows().filter(
      (r) => r.action.toLowerCase().includes(q) || (r.message ?? '').toLowerCase().includes(q),
    );
  });

  protected onFilter(e: Event): void {
    this.filter.set((e.target as HTMLInputElement).value);
  }

  /** Trim the verb tail for a compact badge, e.g. `webhook.stripe.x` → `webhook`. */
  protected shortAction(action: string): string {
    return action.split('.')[0] || action;
  }

  protected actionVariant(action: string): BadgeVariant {
    if (action.includes('fail') || action.includes('error') || action.includes('delete')) return 'danger';
    if (action.includes('publish') || action.includes('completed') || action.includes('paid')) return 'success';
    if (action.includes('hostname') || action.includes('domain') || action.includes('billing')) return 'info';
    if (action.includes('workflow') || action.includes('build')) return 'warning';
    return 'neutral';
  }

  protected reload(): void {
    location.reload();
  }
}
