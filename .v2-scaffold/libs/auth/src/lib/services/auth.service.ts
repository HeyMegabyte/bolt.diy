/**
 * AuthService — owns the `/api/auth/me` cache + sign-out flow.
 *
 * @remarks
 * RxJS-first per `[[rxjs-first-angular]]`. The service exposes:
 *
 * - `me$` — long-lived `Observable<Me | null>` that polls `/api/auth/me`
 *   every 60s, multicasts via `shareReplay({ bufferSize: 1, refCount: false })`,
 *   and recovers from transient errors by emitting `null` (signed-out shape).
 * - `currentUser` — read-only signal materialised from `me$` via `toSignal`,
 *   ready to be consumed by templates without `async` pipe noise.
 * - `signIn$()` / `signOut$()` — Observable<void> mutations that refresh `me$`.
 *
 * NEVER call `firstValueFrom` inside this service. Templates and effects
 * consume the signal; data-access callers compose on `me$`. The single
 * exception is `refresh$()` which uses `take(1)` to side-effect-poke the
 * shared stream.
 *
 * @example
 * ```ts
 * // Template — read current user as a signal.
 * <p>{{ authService.currentUser()?.user.email }}</p>
 *
 * // Component class — compose on me$.
 * readonly capabilities$ = this.authService.me$.pipe(
 *   map((me) => me?.capabilities ?? []),
 * );
 * ```
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
  take,
  tap,
} from 'rxjs';
// TODO: lock in once domain agent lands the Zod runtime exports on @org/domain.
import type { Me } from '@org/domain';

const ME_POLL_INTERVAL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  /**
   * Manual refresh trigger. Emits whenever a sign-in / sign-out / role
   * switch needs to invalidate the cached `Me` shape.
   */
  private readonly refresh$$ = new Subject<void>();

  /**
   * Long-lived multicasted `/api/auth/me` stream.
   *
   * @remarks
   * - 60s poll via `repeat({ delay })`.
   * - Manual refreshes via {@link refresh$$}.
   * - Transient HTTP errors collapse to `null` (signed-out semantics) so the
   *   UI never sticks on a stale Me; the next poll heals automatically.
   */
  readonly me$: Observable<Me | null> = merge(
    of<void>(undefined),
    this.refresh$$,
  ).pipe(
    switchMap(() =>
      this.http.get<Me>('/api/auth/me').pipe(
        catchError(() => of<Me | null>(null)),
        repeat({ delay: ME_POLL_INTERVAL_MS }),
      ),
    ),
    startWith<Me | null>(null),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  /**
   * Signal-shaped `Me` for templates. Updates as `me$` emits.
   */
  readonly currentUser = toSignal(this.me$, { initialValue: null });

  /**
   * Imperative refresh trigger. Used by sign-in / sign-out / role-switch.
   */
  refresh$(): Observable<void> {
    this.refresh$$.next();
    return this.me$.pipe(
      take(1),
      map(() => undefined),
    );
  }

  /**
   * Sign-in via username/password (legacy bcrypt) or any session-cookie
   * granting POST. Most callers prefer OAuth / magic-link / passkey
   * services; this is here for tests + edge surfaces.
   */
  signIn$(payload: { email: string; password: string }): Observable<Me> {
    return this.http.post<Me>('/api/auth/sign-in', payload).pipe(
      tap(() => this.refresh$$.next()),
    );
  }

  /**
   * Sign-out — clears server session, then poke `me$` so `currentUser`
   * reads `null` on the next tick.
   */
  signOut$(): Observable<void> {
    return this.http.post<void>('/api/auth/sign-out', {}).pipe(
      tap(() => this.refresh$$.next()),
    );
  }
}
