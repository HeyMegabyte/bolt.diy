/**
 * @fileoverview AI Task Tray — fixed top-right card stack that surfaces
 * elicitation prompts posted by long-running Cloudflare Workflows. The
 * tray polls `GET /api/inbox/tasks` every 8s (paused while the tab is
 * hidden) and resolves a chosen option via `POST /api/inbox/tasks/:id/resolve`.
 *
 * Designed as a passive overlay — mounted once in the admin shell, it
 * silently shows nothing when the inbox is empty. As soon as a workflow
 * calls `postAskUser`, the matching card animates in and an aria-live
 * announcement fires for screen-reader users.
 *
 * @example
 * ```html
 * <!-- mount in admin shell -->
 * <app-task-tray />
 * ```
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { catchError, of } from 'rxjs';

/**
 * Hydrated task view returned by `GET /api/inbox/tasks`. Mirrors
 * `TaskInboxView` in `src/services/task_inbox.ts` (worker side).
 */
interface TaskInboxView {
  id: string;
  orgId: string;
  workflowInstanceId: string | null;
  taskKind: string;
  prompt: string;
  options: string[];
  defaultChoice: string | null;
  expiresAt: number;
  resolvedAt: number | null;
  resolution: { choice: string } | null;
  createdAt: number;
  createdBy: string | null;
}

const POLL_INTERVAL_MS = 8_000;

@Component({
  selector: 'app-task-tray',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  styles: [
    `
      :host {
        position: fixed;
        top: 72px;
        right: 16px;
        z-index: calc(var(--ps-z-overlay-takeover, 100000) - 1);
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
        pointer-events: none;
        font: inherit;
      }
      :host > * {
        pointer-events: auto;
      }
      .tt-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px 10px;
        border-radius: 999px;
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 22%, transparent);
        color: var(--ps-ink, #f4f4ff);
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 45%, transparent);
        box-shadow: 0 4px 18px -8px color-mix(in oklch, var(--ps-accent, #00e5ff) 60%, transparent);
      }
      .tt-badge__count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 999px;
        background: var(--ps-accent, #00e5ff);
        color: var(--ps-bg, #060610);
        font-size: 0.7rem;
        font-weight: 700;
      }
      .tt-card {
        width: min(360px, calc(100vw - 32px));
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: color-mix(in oklch, var(--ps-bg, #060610) 88%, transparent);
        backdrop-filter: blur(22px) saturate(140%);
        -webkit-backdrop-filter: blur(22px) saturate(140%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: var(--ps-radius-xl, 22px);
        color: var(--ps-ink, #f4f4ff);
        box-shadow: var(
          --ps-shadow-modal,
          0 24px 64px rgba(0, 0, 0, 0.55),
          0 0 80px rgba(0, 229, 255, 0.06)
        );
        animation: tt-in 0.24s cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      @keyframes tt-in {
        from {
          opacity: 0;
          transform: translateY(-6px) scale(0.985);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .tt-card {
          animation: none;
        }
      }
      .tt-kind {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.08);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 80%, transparent);
        font-family: var(--ps-font-mono, 'JetBrains Mono', ui-monospace, monospace);
        font-size: 0.66rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        align-self: flex-start;
      }
      .tt-prompt {
        margin: 0;
        font-size: 0.92rem;
        line-height: 1.4;
        color: var(--ps-ink, #f4f4ff);
        text-wrap: pretty;
      }
      .tt-options {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .tt-opt {
        padding: 6px 12px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: var(--ps-ink, #f4f4ff);
        font: inherit;
        font-size: 0.84rem;
        cursor: pointer;
        transition:
          border-color 0.18s,
          background 0.18s,
          transform 0.12s;
      }
      .tt-opt:hover {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 55%, transparent);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 10%, transparent);
      }
      .tt-opt:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 2px;
      }
      .tt-opt:disabled {
        opacity: 0.5;
        cursor: progress;
      }
      .tt-opt--default {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, transparent);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent);
        color: var(--ps-ink, #f4f4ff);
      }
      .tt-freeform {
        display: flex;
        gap: 6px;
      }
      .tt-input {
        flex: 1 1 auto;
        padding: 6px 10px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: var(--ps-ink, #f4f4ff);
        font: inherit;
        font-size: 0.84rem;
      }
      .tt-input:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 1px;
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 55%, transparent);
      }
      .tt-send {
        padding: 6px 14px;
        border-radius: 10px;
        border: 1px solid transparent;
        background: var(--ps-accent, #00e5ff);
        color: var(--ps-bg, #060610);
        font: inherit;
        font-weight: 600;
        font-size: 0.82rem;
        cursor: pointer;
        transition:
          opacity 0.18s,
          transform 0.12s;
      }
      .tt-send:hover {
        opacity: 0.92;
      }
      .tt-send:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 2px;
      }
      .tt-send:disabled {
        opacity: 0.5;
        cursor: progress;
      }
      .tt-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        font-size: 0.7rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent);
      }
    `,
  ],
  template: `
    @if (count() > 0) {
      <div class="tt-badge" aria-hidden="true">
        Awaiting input
        <span class="tt-badge__count">{{ count() }}</span>
      </div>
    }
    @for (task of tasks(); track task.id) {
      <article class="tt-card" role="dialog" [attr.aria-label]="'AI task: ' + task.taskKind">
        <span class="tt-kind">{{ task.taskKind }}</span>
        <p class="tt-prompt">{{ task.prompt }}</p>

        @if (task.options.length > 0) {
          <div class="tt-options">
            @for (opt of task.options; track opt) {
              <button
                type="button"
                class="tt-opt"
                [class.tt-opt--default]="opt === task.defaultChoice"
                [disabled]="busyId() === task.id"
                (click)="resolve(task, opt)"
              >
                {{ opt }}
              </button>
            }
          </div>
        } @else {
          <form class="tt-freeform" (ngSubmit)="resolveFreeform(task)">
            <input
              type="text"
              class="tt-input"
              [(ngModel)]="freeformText[task.id]"
              name="task-{{ task.id }}"
              placeholder="Type a response…"
              [disabled]="busyId() === task.id"
              autocomplete="off"
            />
            <button
              type="submit"
              class="tt-send"
              [disabled]="busyId() === task.id || !(freeformText[task.id] || '').trim()"
            >
              Send
            </button>
          </form>
        }

        <div class="tt-meta">
          <span>Expires {{ expiresLabel(task) }}</span>
          @if (task.defaultChoice) {
            <span>Default: {{ task.defaultChoice }}</span>
          }
        </div>
      </article>
    }
  `,
  host: {
    'aria-live': 'polite',
    'aria-label': 'AI task tray',
  },
})
export class TaskTrayComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);

  /** Open tasks polled from the worker. */
  readonly tasks = signal<TaskInboxView[]>([]);
  /** Task id currently being resolved (disables its buttons). */
  readonly busyId = signal<string | null>(null);
  /** Free-form input buffer per task id; map kept simple for template ngModel. */
  freeformText: Record<string, string> = {};

  readonly count = computed(() => this.tasks().length);

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onVisibility = (): void => {
    if (!document.hidden) {
      this.refresh();
      this.startTimer();
    } else {
      this.stopTimer();
    }
  };

  ngOnInit(): void {
    this.refresh();
    this.startTimer();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy(): void {
    this.stopTimer();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /**
   * Optimistically remove the task, then POST the resolution. If the
   * server rejects (already resolved, expired, network), we silently
   * let the next poll refill the list.
   */
  resolve(task: TaskInboxView, choice: string): void {
    if (this.busyId()) return;
    this.busyId.set(task.id);
    this.tasks.update((list) => list.filter((t) => t.id !== task.id));

    this.http
      .post<{ ok: boolean }>(`/api/inbox/tasks/${task.id}/resolve`, { choice })
      .pipe(
        catchError(() => {
          // Restore the row on hard network failure so the user can retry.
          this.tasks.update((list) =>
            list.some((t) => t.id === task.id) ? list : [task, ...list],
          );
          return of({ ok: false });
        }),
      )
      .subscribe(() => {
        this.busyId.set(null);
        // Clear free-form buffer regardless of outcome.
        delete this.freeformText[task.id];
      });
  }

  /**
   * Resolve a task with the user-typed free-form answer. No-op when the
   * input is empty so accidental Enter presses don't post blank choices.
   */
  resolveFreeform(task: TaskInboxView): void {
    const value = (this.freeformText[task.id] || '').trim();
    if (!value) return;
    this.resolve(task, value);
  }

  /**
   * Human-readable expiry label rendered on each card — bucketed into
   * `shortly` / `in <1 min` / `in N min` / `in N hr` for legibility.
   *
   * @example expiresLabel({ expiresAt: Date.now() + 5*60_000, ...}) // 'in 5 min'
   */
  expiresLabel(task: TaskInboxView): string {
    const ms = task.expiresAt - Date.now();
    if (ms <= 0) return 'shortly';
    const mins = Math.round(ms / 60_000);
    if (mins < 1) return 'in <1 min';
    if (mins < 60) return `in ${mins} min`;
    const hrs = Math.round(mins / 60);
    return `in ${hrs} hr`;
  }

  private refresh(): void {
    this.http
      .get<{ tasks: TaskInboxView[] }>('/api/inbox/tasks')
      .pipe(catchError(() => of({ tasks: [] as TaskInboxView[] })))
      .subscribe((res) => {
        const next = Array.isArray(res?.tasks) ? res.tasks : [];
        this.tasks.set(next);
      });
  }

  private startTimer(): void {
    this.stopTimer();
    if (typeof document !== 'undefined' && document.hidden) return;
    this.pollTimer = setInterval(() => this.refresh(), POLL_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
