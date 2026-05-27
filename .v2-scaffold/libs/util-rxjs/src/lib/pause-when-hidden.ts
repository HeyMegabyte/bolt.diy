/**
 * Pause an Observable while `document.hidden` is `true`.
 *
 * Mirrors the discipline already in v1's `AdminStateService` — when the
 * tab is backgrounded, suspend the upstream until visibility returns.
 *
 * @example
 * ```ts
 * pollWhile(() => fetchPulse(), { intervalMs: 30_000, condition$: of(true) }).pipe(
 *   pauseWhenHidden(),
 * );
 * ```
 *
 * @remarks SSR-safe: if `document` is undefined the observable passes
 * through unchanged (server-side renders never pause).
 */
import {
  Observable,
  fromEvent,
  of,
  type MonoTypeOperatorFunction,
} from 'rxjs';
import { distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';

function visibility$(): Observable<boolean> {
  if (typeof document === 'undefined') return of(true);
  return fromEvent(document, 'visibilitychange').pipe(
    startWith(null),
    map(() => !document.hidden),
    distinctUntilChanged()
  );
}

export function pauseWhenHidden<T>(): MonoTypeOperatorFunction<T> {
  return (source$: Observable<T>) =>
    visibility$().pipe(switchMap((visible) => (visible ? source$ : new Observable<T>())));
}
