/**
 * CrewService — RxJS-first crew-side data-access.
 *
 * Streams: profile (30s poll), offered-jobs (15s poll), online-status
 * toggle, earnings + schedule. RxJS-first per [[rxjs-first-angular]].
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
  tap,
} from 'rxjs';
import type {
  CrewDocument,
  CrewOnlineStatus,
  CrewProfile,
  Job,
} from '@org/domain';

const PROFILE_POLL_MS = 30_000;
const FEED_POLL_MS = 15_000;

export interface JobOffer {
  readonly job_id: string;
  readonly booking_id: string;
  readonly fare_cents: number;
  readonly distance_m: number;
  readonly expires_at: string;
}

export interface EarningsSummary {
  readonly day_cents: number;
  readonly week_cents: number;
  readonly month_cents: number;
  readonly ytd_cents: number;
  readonly tips_cents: number;
  readonly avg_per_hour_cents: number;
}

export interface ScheduleEntry {
  readonly job_id: string;
  readonly scheduled_for: string;
  readonly duration_min: number;
  readonly fare_cents: number;
  readonly customer_label: string;
}

@Injectable({ providedIn: 'root' })
export class CrewService {
  private readonly http = inject(HttpClient);
  private readonly profileRefresh$$ = new Subject<void>();

  /** Live crew profile for the signed-in user. */
  readonly myProfile$: Observable<CrewProfile | null> = merge(
    of<void>(undefined),
    this.profileRefresh$$,
  ).pipe(
    switchMap(() =>
      this.http.get<CrewProfile>('/api/crew/me').pipe(
        catchError(() => of<CrewProfile | null>(null)),
        repeat({ delay: PROFILE_POLL_MS }),
      ),
    ),
    startWith<CrewProfile | null>(null),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** Pending job offers polled every 15s. */
  readonly offers$: Observable<readonly JobOffer[]> = of<void>(undefined).pipe(
    switchMap(() =>
      this.http.get<{ items: JobOffer[] }>('/api/crew/offers').pipe(
        map((r) => r.items),
        catchError(() => of<JobOffer[]>([])),
        repeat({ delay: FEED_POLL_MS }),
      ),
    ),
    startWith<JobOffer[]>([]),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  setOnlineStatus$(status: CrewOnlineStatus): Observable<void> {
    return this.http
      .post<void>('/api/crew/me/status', { status })
      .pipe(tap(() => this.profileRefresh$$.next()));
  }

  acceptOffer$(jobId: string): Observable<Job> {
    return this.http.post<Job>(
      `/api/crew/offers/${encodeURIComponent(jobId)}/accept`,
      {},
    );
  }

  declineOffer$(jobId: string, reason?: string): Observable<void> {
    return this.http.post<void>(
      `/api/crew/offers/${encodeURIComponent(jobId)}/decline`,
      { reason: reason ?? null },
    );
  }

  earnings$(): Observable<EarningsSummary> {
    return this.http.get<EarningsSummary>('/api/crew/me/earnings').pipe(
      catchError(() =>
        of<EarningsSummary>({
          day_cents: 0,
          week_cents: 0,
          month_cents: 0,
          ytd_cents: 0,
          tips_cents: 0,
          avg_per_hour_cents: 0,
        }),
      ),
      repeat({ delay: 60_000 }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  schedule$(): Observable<readonly ScheduleEntry[]> {
    return this.http
      .get<{ items: ScheduleEntry[] }>('/api/crew/me/schedule')
      .pipe(
        map((r) => r.items),
        catchError(() => of<ScheduleEntry[]>([])),
        repeat({ delay: 60_000 }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
  }

  documents$(): Observable<readonly CrewDocument[]> {
    return this.http
      .get<{ items: CrewDocument[] }>('/api/crew/me/documents')
      .pipe(
        map((r) => r.items),
        catchError(() => of<CrewDocument[]>([])),
        repeat({ delay: 60_000 }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
  }

  uploadDocument$(
    kind: CrewDocument['kind'],
    file: File,
  ): Observable<CrewDocument> {
    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('file', file);
    return this.http.post<CrewDocument>('/api/crew/me/documents', fd);
  }
}
