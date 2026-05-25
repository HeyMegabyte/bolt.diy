/**
 * @module services/toast
 *
 * @description
 * Dedupe-aware global toast queue. Components subscribe to {@link ToastService.toasts}
 * (a signal) and render the array; this service owns id-allocation, deduplication
 * within a short window, optional action buttons (Retry / Undo), correlationId
 * surfacing for support hand-off, and auto-dismiss timers.
 *
 * @remarks
 * - Default durations vary by type: error 7s, warning 6s, info 4.5s, success 4s.
 * - `duration: 0` makes a toast sticky (caller must `dismiss(id)` manually).
 * - Identical (`message` + `type`) toasts inside {@link DEDUPE_WINDOW_MS} collapse
 *   into the existing one — the second `.show()` returns the prior id.
 *
 * @example
 * ```ts
 * const toast = inject(ToastService);
 * toast.success('Saved');
 * const id = toast.info('Uploading…', { duration: 0 });
 * // later
 * toast.dismiss(id);
 * ```
 */
import { Injectable, signal } from '@angular/core';

/** Toast severity → drives default duration and visual treatment. */
export type ToastType = 'error' | 'success' | 'info' | 'warning';

/** Optional one-click action surfaced as a button inside the toast. */
export interface ToastAction {
  /** Visible button label, e.g., "Retry", "Undo". */
  readonly label: string;
  /** Click handler. Receives the toast id so it can dismiss programmatically. */
  readonly run: (toastId: number) => void;
}

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly type: ToastType;
  readonly action?: ToastAction;
  /** Optional correlation id rendered small under the message for support copy. */
  readonly correlationId?: string;
  readonly createdAt: number;
}

export interface ShowOptions {
  /** Override duration (ms). 0 = sticky. Defaults: error 7s, warning 6s, info 4.5s, success 4s. */
  duration?: number;
  /** Optional one-click action (e.g., "Retry", "Undo"). */
  action?: ToastAction;
  /** Optional request id shown small under the message. */
  correlationId?: string;
}

const DEFAULT_DURATION: Record<ToastType, number> = {
  error: 7000,
  warning: 6000,
  success: 4000,
  info: 4500,
};

/** Identical (message+type) within this window collapses into the existing toast. */
const DEDUPE_WINDOW_MS = 2000;

/** Accepts the legacy `(msg, duration)` signature OR the new `(msg, opts)` signature. */
type ShowArg = number | ShowOptions | undefined;

function normalize(arg: ShowArg): ShowOptions {
  if (arg == null) return {};
  return typeof arg === 'number' ? { duration: arg } : arg;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  /** Monotonic per-instance counter — never reused so dismiss() can target safely. */
  private counter = 0;

  /** Active toast queue. Read by the global `<app-toast>` layer in `AppComponent`. */
  readonly toasts = signal<Toast[]>([]);

  /**
   * Generic dispatcher — kept backward-compatible: third arg may be a number
   * (legacy duration in ms) or a {@link ShowOptions} object.
   *
   * @returns The toast id (existing one on dedupe-hit, fresh otherwise).
   */
  show(message: string, type: ToastType = 'info', durationOrOpts: ShowArg = undefined): number {
    const opts = normalize(durationOrOpts);
    const now = Date.now();
    const existing = this.toasts().find(
      (t) => t.message === message && t.type === type && now - t.createdAt < DEDUPE_WINDOW_MS,
    );
    if (existing) return existing.id;

    const id = ++this.counter;
    const duration = opts.duration ?? DEFAULT_DURATION[type];
    const toast: Toast = {
      id,
      message,
      type,
      action: opts.action,
      correlationId: opts.correlationId,
      createdAt: now,
    };
    this.toasts.update((t) => [...t, toast]);
    if (duration > 0) setTimeout(() => this.dismiss(id), duration);
    return id;
  }

  /** Remove a single toast by id. No-op when the id is not active. */
  dismiss(id: number): void {
    this.toasts.update((t) => t.filter((toast) => toast.id !== id));
  }

  /** Clear every active toast — used on full sign-out / route reset. */
  dismissAll(): void {
    this.toasts.set([]);
  }

  /** Shorthand for `show(message, 'error', durationOrOpts)`. */
  error(message: string, durationOrOpts: ShowArg = undefined): number {
    return this.show(message, 'error', durationOrOpts);
  }

  /** Shorthand for `show(message, 'success', durationOrOpts)`. */
  success(message: string, durationOrOpts: ShowArg = undefined): number {
    return this.show(message, 'success', durationOrOpts);
  }

  /** Shorthand for `show(message, 'warning', durationOrOpts)`. */
  warning(message: string, durationOrOpts: ShowArg = undefined): number {
    return this.show(message, 'warning', durationOrOpts);
  }

  /** Shorthand for `show(message, 'info', durationOrOpts)`. */
  info(message: string, durationOrOpts: ShowArg = undefined): number {
    return this.show(message, 'info', durationOrOpts);
  }
}
