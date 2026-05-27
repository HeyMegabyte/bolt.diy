/**
 * BookingsService — RxJS-first data-access for bookings.
 *
 * Long-lived list stream polled every 30s; per-id detail stream polled
 * every 15s. RxJS-first per [[rxjs-first-angular]] — `Observable<T>`
 * end-to-end; consumers bridge via `toSignal()` only at the template.
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
import type { Booking, BookingStatus, MultiDayBooking } from '@org/domain';

const LIST_POLL_MS = 30_000;
const DETAIL_POLL_MS = 15_000;

export interface BookingsFilter {
  readonly status?: BookingStatus;
  readonly role?: 'customer' | 'crew' | 'super_admin';
}

@Injectable({ providedIn: 'root' })
export class BookingsService {
  private readonly http = inject(HttpClient);
  private readonly listRefresh$$ = new Subject<void>();

  listBookings$(filter: BookingsFilter = {}): Observable<readonly Booking[]> {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.role) params.set('role', filter.role);
    const qs = params.toString();
    const url = qs ? `/api/bookings?${qs}` : '/api/bookings';

    return merge(of<void>(undefined), this.listRefresh$$).pipe(
      switchMap(() =>
        this.http.get<{ items: Booking[] }>(url).pipe(
          map((r) => r.items),
          catchError(() => of<Booking[]>([])),
          repeat({ delay: LIST_POLL_MS }),
        ),
      ),
      startWith<Booking[]>([]),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  getBooking$(id: string): Observable<Booking | null> {
    return this.http
      .get<Booking>(`/api/bookings/${encodeURIComponent(id)}`)
      .pipe(
        catchError(() => of<Booking | null>(null)),
        repeat({ delay: DETAIL_POLL_MS }),
        startWith<Booking | null>(null),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
  }

  cancel$(id: string, reason: string): Observable<void> {
    return this.http
      .post<void>(`/api/bookings/${encodeURIComponent(id)}/cancel`, { reason })
      .pipe(tap(() => this.listRefresh$$.next()));
  }

  reschedule$(
    id: string,
    scheduled_for: string,
  ): Observable<Booking> {
    return this.http
      .post<Booking>(`/api/bookings/${encodeURIComponent(id)}/reschedule`, {
        scheduled_for,
      })
      .pipe(tap(() => this.listRefresh$$.next()));
  }

  createMultiDay$(payload: Omit<MultiDayBooking, 'id' | 'created_at'>): Observable<MultiDayBooking> {
    return this.http
      .post<MultiDayBooking>('/api/bookings/multi-day', payload)
      .pipe(tap(() => this.listRefresh$$.next()));
  }

  refresh$(): Observable<void> {
    this.listRefresh$$.next();
    return of(undefined);
  }
}
