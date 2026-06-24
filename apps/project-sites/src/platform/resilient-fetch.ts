/**
 * @module platform/resilient-fetch
 * @description Effect-based resilient JSON fetch — the first sanctioned adoption
 * of `effect` in the worker.
 *
 * Per the adoption doctrine: **Zod stays the boundary SSOT** (validate the parsed
 * body with Zod at the call site); `effect` owns control-flow here — typed
 * errors, exponential-backoff retry, and a per-attempt timeout. This is exactly
 * the "control-flow / errors / concurrency inside services" surface Effect is for,
 * and the pattern new external calls adopt incrementally.
 *
 * @example
 * import { Effect } from 'effect';
 * import { fetchJson } from '../platform/resilient-fetch.js';
 * const data = await Effect.runPromise(
 *   fetchJson('https://api.example.com/v1/thing', { retries: 3, timeoutMs: 5000 }),
 * );
 *
 * @see {@link https://effect.website} — Effect docs
 */
import { Effect, Schedule, Duration, Data } from 'effect';

/** The request timed out before a response arrived. */
export class FetchTimeoutError extends Data.TaggedError('FetchTimeoutError')<{
  readonly url: string;
  readonly timeoutMs: number;
}> {}

/** The fetch threw (DNS, connection reset, abort). */
export class FetchNetworkError extends Data.TaggedError('FetchNetworkError')<{
  readonly url: string;
  readonly cause: unknown;
}> {}

/** The server returned a non-2xx status. */
export class FetchHttpError extends Data.TaggedError('FetchHttpError')<{
  readonly url: string;
  readonly status: number;
}> {}

/** The 2xx body failed to parse as JSON. */
export class FetchParseError extends Data.TaggedError('FetchParseError')<{
  readonly url: string;
  readonly cause: unknown;
}> {}

/** Union of every typed failure `fetchJson` can produce. */
export type FetchError = FetchTimeoutError | FetchNetworkError | FetchHttpError | FetchParseError;

export interface FetchJsonOptions {
  /** Retry attempts AFTER the first try (default 2 → up to 3 total). */
  readonly retries?: number;
  /** Per-attempt timeout in ms (default 8000). */
  readonly timeoutMs?: number;
  /** Base backoff in ms for the exponential schedule (default 200). */
  readonly baseDelayMs?: number;
  /** Passed through to `fetch`. */
  readonly init?: RequestInit;
  /** Injectable fetch (defaults to global `fetch`) — eases testing. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Fetch a URL and parse the JSON body, with a per-attempt timeout and
 * exponential-backoff retry. Failures are TYPED ({@link FetchError}) so callers
 * can branch precisely (`Effect.catchTag('FetchHttpError', …)`).
 *
 * @typeParam T - The expected JSON shape. The caller MUST still Zod-validate the
 *   returned value at its boundary — this helper does not validate the shape.
 * @param url - The absolute URL to fetch.
 * @param opts - Retry / timeout / init options.
 * @returns An `Effect` yielding the parsed JSON, failing with a {@link FetchError}.
 *
 * @remarks Impure — performs network I/O.
 */
export function fetchJson<T = unknown>(
  url: string,
  opts: FetchJsonOptions = {},
): Effect.Effect<T, FetchError> {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const baseDelayMs = opts.baseDelayMs ?? 200;
  const doFetch = opts.fetchImpl ?? fetch;

  const attempt = Effect.tryPromise({
    try: (signal) => doFetch(url, { ...opts.init, signal }),
    catch: (cause) => new FetchNetworkError({ url, cause }),
  }).pipe(
    // Per-attempt timeout → typed FetchTimeoutError (Effect aborts the signal).
    Effect.timeoutFail({
      duration: Duration.millis(timeoutMs),
      onTimeout: () => new FetchTimeoutError({ url, timeoutMs }),
    }),
    Effect.flatMap((res): Effect.Effect<T, FetchError> => {
      if (!res.ok) return Effect.fail(new FetchHttpError({ url, status: res.status }));
      return Effect.tryPromise({
        try: () => res.json() as Promise<T>,
        catch: (cause) => new FetchParseError({ url, cause }),
      });
    }),
  );

  // Retry transient failures (network/timeout/5xx) with capped exponential backoff;
  // do NOT retry 4xx (client errors are deterministic) or parse errors.
  const retryable = (e: FetchError): boolean =>
    e._tag === 'FetchNetworkError' ||
    e._tag === 'FetchTimeoutError' ||
    (e._tag === 'FetchHttpError' && e.status >= 500);

  const schedule = Schedule.exponential(Duration.millis(baseDelayMs)).pipe(
    Schedule.intersect(Schedule.recurs(retries)),
    Schedule.whileInput(retryable),
  );

  return Effect.retry(attempt, schedule);
}
