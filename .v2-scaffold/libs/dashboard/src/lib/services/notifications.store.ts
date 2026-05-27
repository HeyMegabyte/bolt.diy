import { DestroyRef, Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, EMPTY, catchError, type Observable } from 'rxjs';
import { webSocket, type WebSocketSubject } from 'rxjs/webSocket';
import type { NotificationFrame } from '../types/domain';

/**
 * Live notifications fed by `/api/notifications/stream` (WebSocket).
 * Exposes:
 *  - `notifications` signal — full ordered list, newest first.
 *  - `unreadCount` signal — derived from `read=false` entries.
 *  - `groupedByDay` signal — `{ dayIso, items }[]` for slide-over UI.
 *
 * @remarks
 * Auto-reconnects on transient close are handled by `rxjs/webSocket`'s
 * built-in reconnection via the consumer side; if the server closes
 * uncleanly we drop the stream and let the bell badge surface stale
 * state (the health WS will go red separately).
 */
@Injectable({ providedIn: 'root' })
export class NotificationsStore {
  private readonly destroyRef = inject(DestroyRef);

  private readonly items$ = new BehaviorSubject<readonly NotificationFrame[]>([]);

  /** Live notification list, newest first. */
  readonly notifications = toSignal(this.items$.asObservable(), {
    initialValue: [] as readonly NotificationFrame[],
  });

  /** Badge count for the bell. */
  readonly unreadCount = computed<number>(
    () => this.notifications().filter((n) => !n.read).length,
  );

  /** Grouped slide-over payload — `[{ dayIso, items }]` newest day first. */
  readonly groupedByDay = computed(() => {
    const groups = new Map<string, NotificationFrame[]>();
    for (const item of this.notifications()) {
      const day = item.created_at.slice(0, 10);
      const bucket = groups.get(day) ?? [];
      bucket.push(item);
      groups.set(day, bucket);
    }
    return [...groups.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([dayIso, items]) => ({ dayIso, items }));
  });

  private socket: WebSocketSubject<NotificationFrame> | null = null;

  /** Opens the WS. Idempotent. */
  connect(url = `${this.wsBase()}/api/notifications/stream`): void {
    if (this.socket) return;
    this.socket = webSocket<NotificationFrame>({ url });
    this.frames$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((frame) => {
        if (frame.type === 'snapshot') {
          // Server-side initial dump: treat as a single replace.
          this.items$.next([frame]);
        } else {
          this.items$.next([frame, ...this.items$.value]);
        }
      });
  }

  /** Marks an id read locally and tells the server. */
  markRead(id: string): void {
    this.items$.next(
      this.items$.value.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    this.socket?.next({
      type: 'notification',
      id,
      title: '',
      body: '',
      read: true,
      source_url: null,
      created_at: new Date().toISOString(),
    });
  }

  disconnect(): void {
    this.socket?.complete();
    this.socket = null;
  }

  private frames$(): Observable<NotificationFrame> {
    return (this.socket ?? webSocket<NotificationFrame>('')).pipe(
      catchError(() => EMPTY),
    );
  }

  private wsBase(): string {
    if (typeof globalThis === 'undefined' || typeof globalThis.location === 'undefined') {
      return 'ws://localhost';
    }
    const { protocol, host } = globalThis.location;
    const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${host}`;
  }
}
