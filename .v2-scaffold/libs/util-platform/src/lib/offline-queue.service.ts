/**
 * `OfflineQueueService` — IndexedDB-backed mutation queue with
 * sync-on-reconnect, RxJS-first.
 *
 * @remarks
 * Persists outbound mutations (POST/PUT/PATCH/DELETE) to IndexedDB via
 * `idb-keyval` so they survive an app kill, then replays them in
 * insertion order the moment `navigator.onLine` flips back to `true`.
 *
 * Wired by `offlineInterceptor` (in `@org/auth`) — when offline, the
 * interceptor calls `enqueue()` and returns a synthetic 202 so the UI
 * keeps moving. The queue auto-flushes on the next `online` event.
 *
 * @example
 * ```ts
 * queue.enqueue({ method: 'POST', path: '/api/bookings', body: { ... } });
 * queue.flush$().subscribe(r => log('flushed', r.flushed, 'failed', r.failed));
 * ```
 *
 * @see ../../../libs/auth/src/lib/interceptors/offline.interceptor.ts
 * @see [[rxjs-first-angular]]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@angular/core';
import { Observable, defer, from, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

/** Mutation queued while offline. */
export interface QueuedOp {
  readonly id: string;
  readonly method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly enqueuedAt: number;
}

/** Result of `flush$()`. */
export interface FlushResult {
  readonly flushed: number;
  readonly failed: number;
  readonly remaining: number;
}

interface IdbModule {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const QUEUE_KEY_PREFIX = 'ps:offline-queue:';

async function loadIdb(): Promise<IdbModule> {
  const mod = (await import(/* @vite-ignore */ 'idb-keyval' as string)) as unknown as IdbModule;
  return mod;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function safeOnline(): boolean {
  if (!isBrowser()) return true;
  return typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

@Injectable({ providedIn: 'root' })
export class OfflineQueueService {
  private listenerWired = false;

  constructor() {
    this.wireReconnectListener();
  }

  /** Returns `true` if the browser reports an online connection. */
  isOnline(): boolean {
    return safeOnline();
  }

  /**
   * Persist a mutation. Survives reload, app kill, browser quit.
   *
   * @returns `Observable<QueuedOp>` — emits the stored op, completes.
   */
  enqueue$(op: Omit<QueuedOp, 'id' | 'enqueuedAt'>): Observable<QueuedOp> {
    const entry: QueuedOp = { ...op, id: uid(), enqueuedAt: Date.now() };
    return defer(() => from(loadIdb())).pipe(
      switchMap((idb) => from(idb.set(`${QUEUE_KEY_PREFIX}${entry.id}`, entry))),
      map(() => entry),
    );
  }

  /** Imperative variant for the HTTP interceptor's tight path. */
  enqueue(op: Omit<QueuedOp, 'id' | 'enqueuedAt'>): Promise<QueuedOp> {
    const entry: QueuedOp = { ...op, id: uid(), enqueuedAt: Date.now() };
    return loadIdb().then((idb) => idb.set(`${QUEUE_KEY_PREFIX}${entry.id}`, entry).then(() => entry));
  }

  /** Snapshot of the queue. */
  list$(): Observable<readonly QueuedOp[]> {
    return defer(() => from(loadIdb())).pipe(
      switchMap((idb) =>
        from(idb.keys()).pipe(
          switchMap((keys) => {
            const ours = keys.filter((k) => typeof k === 'string' && k.startsWith(QUEUE_KEY_PREFIX));
            if (ours.length === 0) return of<readonly QueuedOp[]>([]);
            return from(
              Promise.all(ours.map((k) => idb.get<QueuedOp>(k))),
            ).pipe(
              map((rows) =>
                (rows.filter(Boolean) as QueuedOp[]).sort((a, b) => a.enqueuedAt - b.enqueuedAt),
              ),
            );
          }),
        ),
      ),
    );
  }

  /**
   * Replay every queued op against `fetch`, removing each on success.
   * Stops as soon as the browser reports offline again.
   *
   * @returns `Observable<FlushResult>` — emits once, completes.
   */
  flush$(): Observable<FlushResult> {
    if (!isBrowser() || !safeOnline()) {
      return of<FlushResult>({ flushed: 0, failed: 0, remaining: 0 });
    }
    return this.list$().pipe(
      switchMap((ops) => from(this.flushSequential(ops))),
    );
  }

  /** Clear every queued op (used by sign-out / test reset). */
  clear$(): Observable<void> {
    return defer(() => from(loadIdb())).pipe(
      switchMap((idb) =>
        from(idb.keys()).pipe(
          switchMap((keys) => {
            const ours = keys.filter((k) => typeof k === 'string' && k.startsWith(QUEUE_KEY_PREFIX));
            return from(Promise.all(ours.map((k) => idb.del(k))));
          }),
        ),
      ),
      map(() => void 0),
    );
  }

  private async flushSequential(ops: readonly QueuedOp[]): Promise<FlushResult> {
    const idb = await loadIdb();
    let flushed = 0;
    let failed = 0;
    for (const op of ops) {
      if (!safeOnline()) break;
      try {
        const res = await fetch(op.path, {
          method: op.method,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Offline-Queue-Id': op.id,
            ...(op.headers ?? {}),
          },
          body: op.body == null ? undefined : JSON.stringify(op.body),
        });
        if (res.ok || res.status === 202 || res.status === 409) {
          await idb.del(`${QUEUE_KEY_PREFIX}${op.id}`);
          flushed += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    const remainingKeys = (await idb.keys()).filter(
      (k) => typeof k === 'string' && k.startsWith(QUEUE_KEY_PREFIX),
    );
    return { flushed, failed, remaining: remainingKeys.length };
  }

  private wireReconnectListener(): void {
    if (this.listenerWired || !isBrowser()) return;
    this.listenerWired = true;
    window.addEventListener('online', () => {
      this.flush$()
        .pipe(
          tap(() => undefined),
          catchError(() => of<FlushResult>({ flushed: 0, failed: 0, remaining: 0 })),
        )
        .subscribe();
    });
  }
}
