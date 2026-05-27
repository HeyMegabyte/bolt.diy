/**
 * Universal Cmd+Z undo manager.
 *
 * @remarks
 *  Any CRUD operation can call `register({do, undo, label})` and the
 *  service immediately invokes `do()`, queues `undo()` for the next 5
 *  seconds, and surfaces a toast with an "Undo" button. Pressing
 *  `Cmd+Z` / `Ctrl+Z` while the toast is alive replays the queued
 *  undo. The queue is a single most-recent slot — sequential CRUDs
 *  replace the predecessor's slot per "undo last action" semantics.
 *
 *  Per [[rxjs-first-angular]]: state flows through `Subject` streams;
 *  components bridge to signals at the template boundary via
 *  `toSignal(undo.toast$)`.
 *
 *  Wire into a shell once via `@HostListener('window:keydown')` →
 *  `undo.tryUndoShortcut(event)`. Every feature lib registers undos
 *  through the same service; no per-feature keyboard plumbing.
 *
 * @example
 *   this.undo.register({
 *     label: 'Booking deleted',
 *     do: () => this.api.deleteBooking(id),
 *     undo: () => this.api.restoreBooking(id),
 *   });
 */
import { Injectable, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

/** A registered undo action. */
export interface UndoableAction {
  /** Human-readable label shown in the toast ("Booking deleted"). */
  readonly label: string;
  /** Run the operation. May be async. */
  readonly do: () => void | Promise<void>;
  /** Reverse the operation. Must be idempotent + safe to call once. */
  readonly undo: () => void | Promise<void>;
  /** Toast lifetime in ms. Defaults to 5_000. */
  readonly ttlMs?: number;
}

/** The toast shape consumers render. `null` = no active toast. */
export interface UndoToast {
  readonly id: string;
  readonly label: string;
  readonly expiresAt: number;
}

const DEFAULT_TTL_MS = 5_000;

@Injectable({ providedIn: 'root' })
export class UndoManagerService {
  private readonly toastSubject = new BehaviorSubject<UndoToast | null>(null);
  /** Hot observable consumers subscribe to (or bridge via toSignal). */
  readonly toast$ = this.toastSubject.asObservable();
  /** Signal mirror of the active toast — read in templates. */
  readonly toast = toSignal(this.toast$, { initialValue: null });

  /** Currently-armed undo callback. Null when nothing is undoable. */
  private armedUndo: (() => void | Promise<void>) | null = null;
  private armedId: string | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Render-mode tracking — block listeners during SSR. */
  private readonly isBrowser = signal(typeof globalThis !== 'undefined' && typeof globalThis.document !== 'undefined');

  /**
   * Run `action.do()` immediately and arm `action.undo()` for the next
   * `ttlMs` milliseconds. Returns a promise that resolves once `do()`
   * settles so callers can chain UX (close dialog, navigate away).
   */
  async register(action: UndoableAction): Promise<void> {
    await action.do();
    const id = this.makeId();
    const ttl = action.ttlMs ?? DEFAULT_TTL_MS;
    const expiresAt = Date.now() + ttl;
    this.armedUndo = action.undo;
    this.armedId = id;
    this.toastSubject.next({ id, label: action.label, expiresAt });
    this.scheduleExpiry(ttl);
  }

  /**
   * Imperatively trigger the currently-armed undo (called by the toast's
   * "Undo" button OR by `tryUndoShortcut`). No-ops when nothing armed.
   */
  async undo(): Promise<void> {
    const cb = this.armedUndo;
    if (!cb) return;
    this.armedUndo = null;
    this.armedId = null;
    this.toastSubject.next(null);
    this.clearExpiry();
    await cb();
  }

  /** Dismiss the toast without running the undo (timeout or X click). */
  dismiss(): void {
    this.armedUndo = null;
    this.armedId = null;
    this.toastSubject.next(null);
    this.clearExpiry();
  }

  /**
   * Handle a global keydown. Returns `true` when the event matched
   * `Cmd+Z` / `Ctrl+Z` and an undo was triggered, so the host can
   * `preventDefault()`. Returns `false` otherwise — host should bubble.
   */
  tryUndoShortcut(event: KeyboardEvent): boolean {
    if (!this.isBrowser()) return false;
    if (!(event.metaKey || event.ctrlKey)) return false;
    if (event.key.toLowerCase() !== 'z') return false;
    if (event.shiftKey) return false; // Cmd+Shift+Z is redo — out of scope here.
    if (!this.armedUndo) return false;
    // Don't steal undo from form inputs — let native text-undo win there.
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return false;
    }
    if (target instanceof HTMLElement && target.isContentEditable) return false;
    event.preventDefault();
    void this.undo();
    return true;
  }

  private scheduleExpiry(ttl: number): void {
    this.clearExpiry();
    this.expiryTimer = setTimeout(() => this.dismiss(), ttl);
  }

  private clearExpiry(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  private makeId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `undo_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }

  /** Currently armed action id — useful for tests + telemetry. */
  get currentId(): string | null {
    return this.armedId;
  }
}
