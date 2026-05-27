/**
 * Gated polling — re-invoke `source` on an interval, but only while
 * `condition$` is `true`. Flipping the condition pauses without
 * unsubscribing; flipping back resumes.
 *
 * @example
 * ```ts
 * pollWhile(
 *   () => httpClient.get<Job>('/api/jobs/abc'),
 *   { intervalMs: 30_000, condition$: AdminState.tabVisible$ },
 * );
 * ```
 *
 * @remarks Pair with `pauseWhenHidden` when polling is purely UI-driven
 * to keep mobile-bg battery drain in check.
 */
import {
  Observable,
  combineLatest,
  defer,
  EMPTY,
  timer,
  type ObservableInput,
} from 'rxjs';
import { distinctUntilChanged, switchMap } from 'rxjs/operators';

export interface PollWhileOptions {
  /** Poll interval in milliseconds. Must be >0. */
  intervalMs: number;
  /** Gate the polling — `false` pauses, `true` resumes. */
  condition$: Observable<boolean>;
  /** Whether to invoke `source` immediately on subscribe (default true). */
  emitOnSubscribe?: boolean;
}

export function pollWhile<T>(
  source: () => ObservableInput<T>,
  opts: PollWhileOptions
): Observable<T> {
  const initialDelay = opts.emitOnSubscribe === false ? opts.intervalMs : 0;
  return combineLatest([opts.condition$.pipe(distinctUntilChanged())]).pipe(
    switchMap(([active]) =>
      active
        ? timer(initialDelay, opts.intervalMs).pipe(switchMap(() => defer(source)))
        : EMPTY
    )
  );
}
