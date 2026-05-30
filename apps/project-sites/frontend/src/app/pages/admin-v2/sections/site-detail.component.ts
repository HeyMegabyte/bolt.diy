/**
 * @module pages/admin-v2/sections/site-detail
 *
 * V2 site-detail — the deep-link target for a Sites-table "Open" (`/admin/v2/
 * sites/:id`). Closes the structural gap where rows pointed nowhere useful.
 * Shows site meta (status badge, domain, plan, created) + recent build/audit
 * logs in the lazy Monaco read-only viewer. Reactive on the `:id` route param
 * (switchMap → forkJoin of site + logs). 4-state contract on helm primitives
 * per [[spartan-ui-design-system]] + [[angular-large-app-supervisor]].
 *
 * @example Routed as `sites/:id` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, map, of, startWith, switchMap } from 'rxjs';
import { ApiService, type Site, type LogEntry, type FormSubmission } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { V2CodeViewerComponent } from './code-viewer.component';
import { RelativeDatePipe } from './relative-date.pipe';

type DetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; site: Site; logs: LogEntry[] };

@Component({
  selector: 'app-v2-site-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmBadgeDirective,
    V2CodeViewerComponent,
    RelativeDatePipe,
  ],
  template: `
    <a routerLink="/admin/v2" hlmBtn variant="ghost" size="sm" class="mb-3" data-testid="v2-detail-back">← All sites</a>

    @switch (state().status) {
      @case ('loading') {
        <div hlmCard class="h-24 animate-pulse opacity-60" data-testid="v2-detail-loading"></div>
        <div hlmCard class="h-80 mt-3 animate-pulse opacity-60"></div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-detail-error">
          <h3 hlmCardTitle>Couldn't load site</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        <div hlmCard data-testid="v2-detail-meta">
          <div class="flex items-center justify-between gap-3">
            <h2 hlmCardTitle class="text-lg">{{ site()!.business_name }}</h2>
            <span hlmBadge [variant]="badgeVariant(site()!.status)">{{ site()!.status }}</span>
          </div>
          <dl class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><dt class="text-muted-foreground text-xs uppercase tracking-wider">Domain</dt>
              <dd class="text-foreground mt-0.5 truncate">{{ site()!.slug }}.projectsites.dev</dd></div>
            <div><dt class="text-muted-foreground text-xs uppercase tracking-wider">Plan</dt>
              <dd class="text-foreground mt-0.5">{{ site()!.plan || '—' }}</dd></div>
            <div><dt class="text-muted-foreground text-xs uppercase tracking-wider">Build</dt>
              <dd class="text-foreground mt-0.5 tabular-nums">v{{ site()!.current_build_version ?? 0 }}</dd></div>
            <div><dt class="text-muted-foreground text-xs uppercase tracking-wider">Created</dt>
              <dd class="text-foreground mt-0.5 tabular-nums" [title]="shortDate(site()!.created_at)">{{ site()!.created_at | relativeDate }}</dd></div>
          </dl>
        </div>

        <!-- Tab bar -->
        <div class="flex items-center gap-1 mt-4 mb-3 border-b border-border" role="tablist" data-testid="v2-detail-tabs">
          @for (t of tabs; track t.id) {
            <button hlmBtn variant="ghost" size="sm" role="tab" [attr.aria-selected]="tab() === t.id"
                    class="rounded-b-none border-b-2 -mb-px"
                    [class.border-primary]="tab() === t.id"
                    [class.text-primary]="tab() === t.id"
                    [class.border-transparent]="tab() !== t.id"
                    (click)="tab.set(t.id)" [attr.data-testid]="'v2-detail-tab-' + t.id">{{ t.label }}</button>
          }
        </div>

        @if (tab() === 'logs') {
          <div hlmCard data-testid="v2-detail-logs">
            <div class="flex items-center justify-between">
              <h3 hlmCardTitle>Recent logs</h3>
              <span class="text-xs text-muted-foreground tabular-nums">{{ logs().length }} entries</span>
            </div>
            @if (logs().length === 0) {
              <p hlmCardDescription class="mt-1 mb-2">No log entries yet — showing an empty log stream.</p>
            }
            <div class="mt-2">
              <app-v2-code-viewer [value]="logsJson()" language="json" [label]="'Logs for ' + site()!.business_name" />
            </div>
          </div>
        }

        @if (tab() === 'forms') {
          <div hlmCard data-testid="v2-detail-forms">
            <div class="flex items-center justify-between">
              <h3 hlmCardTitle>Form submissions</h3>
              <span class="text-xs text-muted-foreground tabular-nums">{{ forms().length }}</span>
            </div>
            @if (forms().length === 0) {
              <p hlmCardDescription class="mt-1">No form submissions yet.</p>
            } @else {
              <ul class="mt-3 divide-y divide-border/50">
                @for (f of forms(); track f.id) {
                  <li class="py-2 text-sm" data-testid="v2-detail-form-row">
                    <div class="flex items-center justify-between gap-2">
                      <span class="font-medium text-foreground truncate">{{ f.form_name || 'submission' }}</span>
                      <span class="text-xs text-muted-foreground shrink-0 tabular-nums" [title]="f.created_at">{{ f.created_at | relativeDate }}</span>
                    </div>
                    @if (f.email) { <p class="text-xs text-muted-foreground mt-0.5 truncate">{{ f.email }}</p> }
                  </li>
                }
              </ul>
            }
          </div>
        }
      }
    }
  `,
})
export class V2SiteDetailComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  protected readonly state = toSignal(
    this.route.paramMap.pipe(
      switchMap((pm) => {
        const id = pm.get('id') ?? '';
        return forkJoin({
          site: this.api.getSite(id),
          logs: this.api.getSiteLogs(id).pipe(catchError(() => of({ data: [] as LogEntry[] }))),
        }).pipe(
          map(
            (r) => ({ status: 'ready', site: r.site.data, logs: r.logs.data ?? [] }) as DetailState,
          ),
          startWith({ status: 'loading' } as DetailState),
          catchError((e: unknown) =>
            of({
              status: 'error',
              message: (e as { message?: string })?.message ?? 'Network error',
            } as DetailState),
          ),
        );
      }),
    ),
    { initialValue: { status: 'loading' } as DetailState },
  );

  protected readonly site = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.site : null;
  });
  protected readonly logs = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.logs : [];
  });
  protected readonly logsJson = computed(() => JSON.stringify(this.logs(), null, 2));
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  // ── Per-site tabs ──────────────────────────────────────────
  protected readonly tabs = [
    { id: 'logs' as const, label: 'Logs' },
    { id: 'forms' as const, label: 'Forms' },
  ];
  protected readonly tab = signal<'logs' | 'forms'>('logs');

  /** Form submissions, reactive on the route :id (independent of the meta stream). */
  private readonly formsRaw = toSignal(
    this.route.paramMap.pipe(
      switchMap((pm) =>
        this.api.listFormSubmissions(pm.get('id') ?? '', 50).pipe(
          map((r) => r.data ?? []),
          catchError(() => of([] as FormSubmission[])),
        ),
      ),
    ),
    { initialValue: [] as FormSubmission[] },
  );
  protected readonly forms = computed(() => this.formsRaw());

  protected shortDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  protected reload(): void {
    location.reload();
  }

  protected badgeVariant(status: string): BadgeVariant {
    switch (status) {
      case 'published':
        return 'success';
      case 'building':
      case 'generating':
        return 'info';
      case 'error':
        return 'danger';
      default:
        return 'neutral';
    }
  }
}
