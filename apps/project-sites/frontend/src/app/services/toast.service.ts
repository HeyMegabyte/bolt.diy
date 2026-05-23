import { Injectable, signal } from '@angular/core';

export type ToastType = 'error' | 'success' | 'info' | 'warning';

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
  private counter = 0;
  readonly toasts = signal<Toast[]>([]);

  /** Generic dispatcher — kept backward-compatible: third arg may be a number (legacy duration) or options. */
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

  dismiss(id: number): void {
    this.toasts.update((t) => t.filter((toast) => toast.id !== id));
  }

  dismissAll(): void {
    this.toasts.set([]);
  }

  error(message: string, durationOrOpts: ShowArg = undefined): number {
    return this.show(message, 'error', durationOrOpts);
  }

  success(message: string, durationOrOpts: ShowArg = undefined): number {
    return this.show(message, 'success', durationOrOpts);
  }

  warning(message: string, durationOrOpts: ShowArg = undefined): number {
    return this.show(message, 'warning', durationOrOpts);
  }

  info(message: string, durationOrOpts: ShowArg = undefined): number {
    return this.show(message, 'info', durationOrOpts);
  }
}
