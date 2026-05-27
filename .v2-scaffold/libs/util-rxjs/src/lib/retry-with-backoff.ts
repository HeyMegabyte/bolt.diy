/**
 * Exponential-backoff retry operator with optional jitter.
 *
 * @example
 * ```ts
 * httpClient.get('/api/billing/subscription').pipe(
 *   retryWithBackoff({ count: 3, baseMs: 300, maxMs: 5000, jitter: true }),
 * );
 * ```
 *
 * @remarks Idempotency is the caller's responsibility — do not wrap
 * non-idempotent mutations.
 */
import { Observable, throwError, timer, type MonoTypeOperatorFunction } from 'rxjs';
import { mergeMap, retry } from 'rxjs/operators';

export interface RetryWithBackoffOptions {
  /** Maximum retry attempts (default 3). */
  count?: number;
  /** Initial delay before the first retry (default 250ms). */
  baseMs?: number;
  /** Upper bound on any single delay (default 30s). */
  maxMs?: number;
  /** Apply ±50% jitter to each delay (default true). */
  jitter?: boolean;
  /** Predicate to decide whether to retry a given error (default: always retry). */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

export function retryWithBackoff<T>(
  opts: RetryWithBackoffOptions = {}
): MonoTypeOperatorFunction<T> {
  const count = opts.count ?? 3;
  const baseMs = opts.baseMs ?? 250;
  const maxMs = opts.maxMs ?? 30_000;
  const jitter = opts.jitter ?? true;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  return (source$: Observable<T>) =>
    source$.pipe(
      retry({
        count,
        delay: (err, attempt) => {
          if (!shouldRetry(err, attempt)) return throwError(() => err);
          const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
          const delay = jitter ? exp * (0.5 + Math.random()) : exp;
          return timer(Math.min(maxMs, delay));
        },
      }),
      // Re-throw via mergeMap-passthrough so downstream sees the error type as `unknown`.
      mergeMap((v) => [v])
    );
}
