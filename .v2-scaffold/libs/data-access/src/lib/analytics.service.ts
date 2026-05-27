/**
 * `AnalyticsService` — privacy-first per-site analytics dashboard wrapper
 * (backlog #27).
 *
 * @remarks
 *  Talks to `/_pa/aggregates` on the TENANT runtime, not the control-plane.
 *  Components configure the tenant base URL via the `baseUrl` argument so the
 *  admin can poll any site they own.
 *
 *  Polling cadence: 30s, multicast via `shareReplay`. Transient HTTP errors
 *  collapse to the last-known frame so the dashboard never sticks on a stale
 *  "Loading" state.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  type Observable,
  Subject,
  catchError,
  map,
  merge,
  of,
  repeat,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';

const AGGREGATES_POLL_MS = 30_000;

export interface AnalyticsTotals {
  readonly views: number;
  readonly uniques: number;
}

export interface AnalyticsTopPage {
  readonly path: string;
  readonly views: number;
  readonly uniques: number;
}

export interface AnalyticsTopReferrer {
  readonly source: string;
  readonly visits: number;
}

export interface AnalyticsTrendCell {
  readonly day: string;
  readonly views: number;
  readonly uniques: number;
}

export interface AnalyticsAggregates {
  readonly window_days: number;
  readonly totals: AnalyticsTotals;
  readonly top_pages: ReadonlyArray<AnalyticsTopPage>;
  readonly top_referrers: ReadonlyArray<AnalyticsTopReferrer>;
  readonly daily_trend: ReadonlyArray<AnalyticsTrendCell>;
}

const EMPTY: AnalyticsAggregates = {
  window_days: 7,
  totals: { views: 0, uniques: 0 },
  top_pages: [],
  top_referrers: [],
  daily_trend: [],
};

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);
  private readonly refresh$$ = new Subject<void>();

  /**
   * Live aggregates for `baseUrl`. Caller is expected to provide the tenant
   * site origin (e.g. `https://acme.projectsites.dev`); CORS is allowed on
   * the `/_pa/aggregates` endpoint when the request carries the admin's
   * auth cookie (same-origin via the dashboard's reverse proxy).
   */
  aggregates$(baseUrl: string): Observable<AnalyticsAggregates> {
    const url = `${baseUrl.replace(/\/+$/, '')}/_pa/aggregates`;
    return merge(of<void>(undefined), this.refresh$$).pipe(
      switchMap(() =>
        this.http.get<AnalyticsAggregates>(url, { withCredentials: true }).pipe(
          catchError(() => of<AnalyticsAggregates>(EMPTY)),
          repeat({ delay: AGGREGATES_POLL_MS }),
        ),
      ),
      startWith<AnalyticsAggregates>(EMPTY),
      map((a) => a ?? EMPTY),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  refresh(): void {
    this.refresh$$.next();
  }
}
