/**
 * @module pages/admin-v2/sections/inbox
 *
 * V2 Inbox / task tray (SYS-ADMIN, org-wide) — mirrors the legacy admin inbox:
 * human-in-the-loop questions the AI/workflows posted via `getInboxTasks()`.
 * Each open task shows its kind · prompt · expiry, and the operator resolves it
 * by clicking an option (`resolveInboxTask`), which fans the choice back into
 * the waiting workflow. A genuinely-missing hand-created feature, now ported.
 * 4-state on helm primitives per [[spartan-ui-design-system]]; ToastService
 * feedback; reload-after-resolve.
 *
 * @example Routed as the `inbox` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { ApiService, type InboxTask } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
} from '../../../ui';
import { ToastService } from '../../../services/toast.service';
import { RelativeDatePipe } from './relative-date.pipe';

type InboxState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tasks: InboxTask[] };

@Component({
  selector: 'app-v2-inbox',
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
    <div class="mb-3 flex items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-foreground">Inbox</h2>
        <p class="text-sm text-muted-foreground">Questions the AI needs you to answer</p>
      </div>
      <button hlmBtn variant="ghost" size="sm" (click)="reload()" data-testid="v2-inbox-refresh">Refresh</button>
    </div>

    @switch (state().status) {
      @case ('loading') {
        <div class="flex flex-col gap-2" data-testid="v2-inbox-loading">
          @for (s of [0,1,2]; track s) { <div hlmCard class="h-20 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-inbox-error">
          <h3 hlmCardTitle>Couldn't load the inbox</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        @if (tasks().length === 0) {
          <div hlmCard class="text-center py-8" data-testid="v2-inbox-empty">
            <p hlmCardDescription>All caught up — no questions need your input.</p>
          </div>
        } @else {
          <ul class="flex flex-col gap-3" data-testid="v2-inbox-list">
            @for (t of tasks(); track t.id) {
              <li hlmCard data-testid="v2-inbox-task">
                <div class="flex items-center gap-2">
                  <span hlmBadge variant="warning" class="shrink-0">{{ t.taskKind }}</span>
                  <span class="flex-1"></span>
                  <span class="text-xs text-muted-foreground tabular-nums shrink-0">expires {{ expiry(t) }}</span>
                </div>
                <p class="mt-2 text-sm text-foreground">{{ t.prompt }}</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  @for (opt of t.options; track opt) {
                    <button hlmBtn size="sm" [variant]="opt === t.defaultChoice ? 'primary' : 'secondary'"
                            [disabled]="resolving() === t.id"
                            (click)="resolve(t, opt)"
                            [attr.data-testid]="'v2-inbox-opt-' + t.id">{{ opt }}</button>
                  }
                  @if (t.options.length === 0) {
                    <span class="text-xs text-muted-foreground">Free-text task — resolve in the classic admin.</span>
                  }
                </div>
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class V2InboxComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly reloadKey = signal(0);
  protected readonly resolving = signal<string | null>(null);

  protected readonly state = toSignal(
    toObservable(this.reloadKey).pipe(
      switchMap(() =>
        this.api.getInboxTasks().pipe(
          map((r) => ({ status: 'ready', tasks: r.tasks ?? [] }) as InboxState),
          startWith({ status: 'loading' } as InboxState),
          catchError((e: unknown) =>
            of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as InboxState),
          ),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as InboxState },
  );

  protected readonly tasks = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.tasks : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected expiry(t: InboxTask): string {
    if (!t.expiresAt) return '—';
    const d = new Date(t.expiresAt);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  protected resolve(t: InboxTask, choice: string): void {
    this.resolving.set(t.id);
    this.api.resolveInboxTask(t.id, choice).subscribe({
      next: () => {
        this.resolving.set(null);
        this.toast.success('Answer sent.');
        this.reload();
      },
      error: () => {
        this.resolving.set(null);
        this.toast.error('Could not resolve the task.');
      },
    });
  }

  protected reload(): void {
    this.reloadKey.update((n) => n + 1);
  }
}
