/**
 * `SqlService` — per-site D1 query workbench wrapper.
 *
 * Talks to `/api/sites/:siteId/sql/*`:
 *   - `GET  /schema`  → tables + columns for Monaco autocomplete
 *   - `POST /execute` → run a query (read or write); server enforces
 *     read-only unless `write_mode: true` is set + the caller has
 *     `site.sql.write` capability.
 *
 * Query history is per-user per-site, persisted client-side in
 * `localStorage` (cap: 100 entries per site).
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  map,
  shareReplay,
  timer,
} from 'rxjs';
import { retry } from 'rxjs/operators';

export interface SqlColumn {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly primary_key: boolean;
}

export interface SqlTable {
  readonly name: string;
  readonly columns: ReadonlyArray<SqlColumn>;
}

export interface SqlSchema {
  readonly site_id: string;
  readonly tables: ReadonlyArray<SqlTable>;
}

export interface SqlExecuteResponse {
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly rows_read: number;
  readonly rows_written: number;
  readonly duration_ms: number;
}

export interface SqlHistoryEntry {
  readonly sql: string;
  readonly executed_at: string;
  readonly duration_ms: number;
  readonly rows_returned: number;
  readonly success: boolean;
}

const HISTORY_CAP = 100;

// TODO: lock in once util-rxjs lands — replace with retryWithBackoff from @org/util-rxjs.
function retryWithBackoff<T>(maxAttempts = 3, initialMs = 250) {
  return retry<T>({
    count: maxAttempts,
    delay: (_err, attempt) => timer(Math.min(initialMs * 2 ** attempt, 4_000)),
  });
}

@Injectable({ providedIn: 'root' })
export class SqlService {
  private readonly http = inject(HttpClient);
  private readonly history$ = new Map<string, BehaviorSubject<ReadonlyArray<SqlHistoryEntry>>>();

  introspectSchema$(siteId: string): Observable<SqlSchema> {
    return this.http
      .get<SqlSchema>(`/api/sites/${siteId}/sql/schema`)
      .pipe(
        retryWithBackoff<SqlSchema>(),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
  }

  executeQuery$(
    siteId: string,
    sql: string,
    writeMode = false,
  ): Observable<SqlExecuteResponse> {
    return this.http
      .post<SqlExecuteResponse>(`/api/sites/${siteId}/sql/execute`, {
        sql,
        write_mode: writeMode,
      })
      .pipe(
        map((r) => {
          this.appendHistory(siteId, {
            sql,
            executed_at: new Date().toISOString(),
            duration_ms: r.duration_ms,
            rows_returned: r.rows.length,
            success: true,
          });
          return r;
        }),
      );
  }

  /** Observable of the running per-site query history. */
  queryHistory$(siteId: string): Observable<ReadonlyArray<SqlHistoryEntry>> {
    return this.historySubject(siteId).asObservable();
  }

  /** Used by feature-sql after a query error to record the failure. */
  recordFailure(siteId: string, sql: string): void {
    this.appendHistory(siteId, {
      sql,
      executed_at: new Date().toISOString(),
      duration_ms: 0,
      rows_returned: 0,
      success: false,
    });
  }

  clearHistory(siteId: string): void {
    this.historySubject(siteId).next([]);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.storageKey(siteId));
    }
  }

  private historySubject(
    siteId: string,
  ): BehaviorSubject<ReadonlyArray<SqlHistoryEntry>> {
    let subj = this.history$.get(siteId);
    if (!subj) {
      subj = new BehaviorSubject<ReadonlyArray<SqlHistoryEntry>>(
        this.readHistory(siteId),
      );
      this.history$.set(siteId, subj);
    }
    return subj;
  }

  private appendHistory(siteId: string, entry: SqlHistoryEntry): void {
    const current = this.historySubject(siteId).getValue();
    const next = [entry, ...current].slice(0, HISTORY_CAP);
    this.historySubject(siteId).next(next);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.storageKey(siteId), JSON.stringify(next));
      } catch {
        // Quota / privacy mode — swallow; in-memory copy is still authoritative.
      }
    }
  }

  private readHistory(siteId: string): ReadonlyArray<SqlHistoryEntry> {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(this.storageKey(siteId));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ReadonlyArray<SqlHistoryEntry>;
      return Array.isArray(parsed) ? parsed.slice(0, HISTORY_CAP) : [];
    } catch {
      return [];
    }
  }

  private storageKey(siteId: string): string {
    return `org:sql-history:${siteId}`;
  }
}
