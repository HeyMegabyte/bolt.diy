import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { webSocket, type WebSocketSubject } from 'rxjs/webSocket';
import type { HealthFrame } from '../types/domain';

/**
 * Edge health beacon. Subscribes to `/api/health/stream` and exposes
 * `isHealthy` as a signal. Green when the most recent frame had
 * `ok: true` within the freshness window; red on disconnect or stale
 * data.
 */
@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly destroyRef = inject(DestroyRef);

  private readonly healthy$ = new BehaviorSubject<boolean>(false);

  readonly isHealthy = toSignal(this.healthy$.asObservable(), { initialValue: false });

  private socket: WebSocketSubject<HealthFrame> | null = null;
  private lastBeatAt = 0;
  private stalenessTimer: ReturnType<typeof setInterval> | null = null;

  /** Opens the health WS. Idempotent. */
  connect(url = `${this.wsBase()}/api/health/stream`, stalenessMs = 30_000): void {
    if (this.socket) return;
    this.socket = webSocket<HealthFrame>({ url });
    this.socket
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (frame) => {
          this.lastBeatAt = Date.now();
          this.healthy$.next(frame.ok);
        },
        error: () => this.healthy$.next(false),
        complete: () => this.healthy$.next(false),
      });
    this.stalenessTimer = setInterval(() => {
      if (Date.now() - this.lastBeatAt > stalenessMs) {
        this.healthy$.next(false);
      }
    }, Math.max(1000, Math.floor(stalenessMs / 3)));
  }

  disconnect(): void {
    this.socket?.complete();
    this.socket = null;
    if (this.stalenessTimer) {
      clearInterval(this.stalenessTimer);
      this.stalenessTimer = null;
    }
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
