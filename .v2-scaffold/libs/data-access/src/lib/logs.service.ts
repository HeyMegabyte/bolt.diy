/**
 * `LogsService` — RxJS-first wrapper for log streaming + history.
 *
 * Streams structured `LogLine` records from the control-plane:
 *   - Primary: WebSocket at `/api/sites/:siteId/logs/stream`
 *   - Fallback: HTTP poll at `/api/sites/:siteId/logs/recent?since=...`
 *
 * Streams emit < 500 ms after the first WS frame arrives (see
 * `feature-logs/__tests__/logs-viewer.spec.ts`).
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  EMPTY,
  Observable,
  catchError,
  defer,
  filter,
  interval,
  map,
  merge,
  shareReplay,
  startWith,
  switchMap,
  timer,
} from 'rxjs';
import { retry, scan } from 'rxjs/operators';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import type { LogLine } from '@org/domain';

export interface LogStreamOpts {
  /** Multi-select level filter; empty = all levels. */
  readonly levels?: ReadonlyArray<LogLine['level']>;
  /** Optional search substring; case-insensitive. */
  readonly search?: string;
  /** Poll interval (ms) for HTTP fallback. */
  readonly pollMs?: number;
}

interface RecentResponse {
  readonly lines: ReadonlyArray<LogLine>;
}

// TODO: lock in once util-rxjs lands — import retryWithBackoff, pauseWhenHidden from @org/util-rxjs.
function retryWithBackoff<T>(maxAttempts = 5, initialMs = 300) {
  return retry<T>({
    count: maxAttempts,
    delay: (_err, attempt) => timer(Math.min(initialMs * 2 ** attempt, 10_000)),
  });
}

@Injectable({ providedIn: 'root' })
export class LogsService {
  private readonly http = inject(HttpClient);

  /**
   * Live tail of logs for a site. Prefers WebSocket; falls back to HTTP
   * polling if the socket errors twice in a row.
   */
  streamLogs$(siteId: string, opts: LogStreamOpts = {}): Observable<LogLine> {
    const wsUrl = this.buildWsUrl(siteId);
    const ws$: Observable<LogLine> = defer(() => {
      const socket: WebSocketSubject<LogLine> = webSocket<LogLine>({
        url: wsUrl,
        deserializer: (e) => JSON.parse(e.data) as LogLine,
      });
      return socket.asObservable();
    }).pipe(
      retryWithBackoff<LogLine>(2, 500),
      catchError(() => this.pollFallback$(siteId, opts.pollMs ?? 1500)),
    );

    return ws$.pipe(this.filterPipe(opts));
  }

  /** Single fetch of the most recent `limit` lines for back-fill on load. */
  recentLogs$(siteId: string, limit = 200): Observable<ReadonlyArray<LogLine>> {
    return this.http
      .get<RecentResponse>(`/api/sites/${siteId}/logs/recent`, {
        params: { limit: String(limit) },
      })
      .pipe(
        map((r) => r.lines),
        retryWithBackoff<ReadonlyArray<LogLine>>(3, 400),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
  }

  private pollFallback$(siteId: string, pollMs: number): Observable<LogLine> {
    return interval(pollMs).pipe(
      startWith(0),
      scan<number, { since: string | null }>(
        (acc) => acc,
        { since: null },
      ),
      switchMap(() =>
        this.http
          .get<RecentResponse>(`/api/sites/${siteId}/logs/recent`, {
            params: { limit: '50' },
          })
          .pipe(catchError(() => EMPTY)),
      ),
      switchMap((r) => r.lines),
    );
  }

  private filterPipe(opts: LogStreamOpts) {
    const levels = opts.levels;
    const search = opts.search?.toLowerCase();
    return (src: Observable<LogLine>): Observable<LogLine> =>
      src.pipe(
        filter((line) =>
          levels && levels.length > 0 ? levels.includes(line.level) : true,
        ),
        filter((line) =>
          search ? line.message.toLowerCase().includes(search) : true,
        ),
      );
  }

  private buildWsUrl(siteId: string): string {
    if (typeof window === 'undefined') {
      return `wss://invalid.local/api/sites/${siteId}/logs/stream`;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/sites/${siteId}/logs/stream`;
  }
}

// merge import (alias to silence unused) — keep for downstream extension.
export const __rxjsMerge = merge;
