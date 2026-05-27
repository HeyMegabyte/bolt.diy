/**
 * TTL-cached observable. The first subscriber triggers `source$`; any
 * subscriber within `ttlMs` of that first emission receives the cached
 * value without re-invoking the upstream. After the TTL expires, the
 * next subscriber re-fetches.
 *
 * Designed for entitlements / capability / `me` payloads that don't
 * change minute-to-minute but get queried from every feature lib.
 *
 * @example
 * ```ts
 * const me$ = cacheFirst(() => httpClient.get<Me>('/api/auth/me'), 60_000);
 * ```
 */
import { Observable, defer, of } from 'rxjs';
import { share, tap } from 'rxjs/operators';

export function cacheFirst<T>(
  factory: () => Observable<T>,
  ttlMs: number
): Observable<T> {
  let cached: { value: T; expiresAt: number } | null = null;
  let inflight: Observable<T> | null = null;

  return defer(() => {
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return of(cached.value);
    }
    if (inflight) return inflight;
    inflight = factory().pipe(
      tap({
        next: (value) => {
          cached = { value, expiresAt: Date.now() + ttlMs };
        },
        finalize: () => {
          inflight = null;
        },
      }),
      share()
    );
    return inflight;
  });
}
