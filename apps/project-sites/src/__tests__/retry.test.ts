/**
 * retry — exponential-backoff retry + transient-error classification.
 *
 * Locks the behavior of `services/retry.ts`:
 *   1. classifyError() — every category branch (timeout/network/rate_limit/
 *      auth/validation/server_error/unknown) via Error message, Error name,
 *      message-embedded status code, and object-shaped {status}/{statusCode}.
 *   2. isTransientError() — retryable (timeout/rate_limit/server_error/network)
 *      vs permanent (auth/validation/unknown).
 *   3. withRetry() — success-first-try, retry-then-succeed, max-retries
 *      exhausted (rethrows LAST error), non-retryable rethrown immediately
 *      without consuming budget, custom retryOn predicate, onRetry callback,
 *      exponential backoff + jitter timing, maxDelayMs cap.
 *
 * Uses jest.useFakeTimers() so backoff delays never wall-clock. Math.random is
 * stubbed to make the jitter term deterministic (no flaky timing assertions).
 */
import {
  classifyError,
  isTransientError,
  withRetry,
  type ErrorCategory,
} from '../services/retry.js';

/** Build an Error whose .name is set (classifyError reads name + message). */
function namedError(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe('retry.classifyError', () => {
  it('classifies timeouts via name and message', () => {
    expect(classifyError(namedError('AbortError', 'x'))).toBe('timeout');
    expect(classifyError(namedError('TimeoutError', 'x'))).toBe('timeout');
    expect(classifyError(new Error('request timeout'))).toBe('timeout');
    expect(classifyError(new Error('operation aborted'))).toBe('timeout');
    expect(classifyError(new Error('connection timed out'))).toBe('timeout');
  });

  it('classifies network failures via name+message and message keywords', () => {
    expect(classifyError(namedError('TypeError', 'failed to fetch'))).toBe('network');
    expect(classifyError(namedError('TypeError', 'network down'))).toBe('network');
    expect(classifyError(new Error('ECONNREFUSED'))).toBe('network');
    expect(classifyError(new Error('read ECONNRESET'))).toBe('network');
    expect(classifyError(new Error('getaddrinfo ENOTFOUND host'))).toBe('network');
    expect(classifyError(new Error('DNS lookup failed'))).toBe('network');
    expect(classifyError(new Error('socket hang up'))).toBe('network');
  });

  it('classifies HTTP status codes embedded in an Error message', () => {
    expect(classifyError(new Error('API error 429: too many'))).toBe('rate_limit');
    expect(classifyError(new Error('status 401 unauthorized'))).toBe('auth');
    expect(classifyError(new Error('status 403 forbidden'))).toBe('auth');
    expect(classifyError(new Error('HTTP 400 bad request'))).toBe('validation');
    expect(classifyError(new Error('HTTP 422 unprocessable'))).toBe('validation');
    expect(classifyError(new Error('upstream 500 boom'))).toBe('server_error');
    expect(classifyError(new Error('502 bad gateway'))).toBe('server_error');
    expect(classifyError(new Error('503 unavailable'))).toBe('server_error');
  });

  it('classifies object-shaped errors via status / statusCode', () => {
    expect(classifyError({ status: 429 })).toBe('rate_limit');
    expect(classifyError({ statusCode: 401 })).toBe('auth');
    expect(classifyError({ status: 403 })).toBe('auth');
    expect(classifyError({ statusCode: 400 })).toBe('validation');
    expect(classifyError({ status: 422 })).toBe('validation');
    expect(classifyError({ status: 503 })).toBe('server_error');
  });

  it('falls back to unknown for unrecognized errors', () => {
    expect(classifyError(new Error('something weird'))).toBe('unknown');
    expect(classifyError('a string')).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
    expect(classifyError(undefined)).toBe('unknown');
    expect(classifyError({})).toBe('unknown');
    // 404 is not specially mapped → unknown (and thus non-transient).
    expect(classifyError(new Error('HTTP 404 not found'))).toBe('unknown');
  });
});

describe('retry.isTransientError', () => {
  const transient: ErrorCategory[] = ['timeout', 'rate_limit', 'server_error', 'network'];
  const permanent: ErrorCategory[] = ['auth', 'validation', 'unknown'];

  it('treats timeout / rate_limit / server_error / network as transient', () => {
    expect(isTransientError(namedError('AbortError', 't'))).toBe(true); // timeout
    expect(isTransientError({ status: 429 })).toBe(true); // rate_limit
    expect(isTransientError({ status: 503 })).toBe(true); // server_error
    expect(isTransientError(new Error('ECONNRESET'))).toBe(true); // network
    expect(transient).toHaveLength(4);
  });

  it('treats auth / validation / unknown as permanent', () => {
    expect(isTransientError({ status: 401 })).toBe(false); // auth
    expect(isTransientError({ status: 400 })).toBe(false); // validation
    expect(isTransientError(new Error('mystery'))).toBe(false); // unknown
    expect(permanent).toHaveLength(3);
  });
});

describe('retry.withRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Make jitter deterministic: Math.random() === 0 → jitter term === 0,
    // so delay === baseDelayMs * 2**attempt (capped at maxDelayMs).
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns immediately on first-try success without scheduling a timer', async () => {
    const fn = jest.fn(async () => 'ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure then succeeds', async () => {
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce('recovered');

    const promise = withRetry(fn, { baseDelayMs: 1000 });
    // Advance the fake timer past the scheduled backoff so the retry fires.
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows the LAST error after exhausting maxRetries', async () => {
    const errA = { status: 503, tag: 'first' };
    const errB = { status: 502, tag: 'second' };
    const errC = { status: 500, tag: 'third' };
    const fn = jest
      .fn<Promise<never>, []>()
      .mockRejectedValueOnce(errA)
      .mockRejectedValueOnce(errB)
      .mockRejectedValueOnce(errC);

    // maxRetries=2 → 3 total attempts (initial + 2 retries).
    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 100 });
    const assertion = expect(promise).rejects.toBe(errC);
    await jest.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('rethrows a non-retryable error immediately without consuming retry budget', async () => {
    const authErr = { status: 401 };
    const fn = jest.fn<Promise<never>, []>().mockRejectedValue(authErr);

    await expect(withRetry(fn, { maxRetries: 5 })).rejects.toBe(authErr);
    expect(fn).toHaveBeenCalledTimes(1); // no retries — permanent error
  });

  it('honors a custom retryOn predicate', async () => {
    const weird = new Error('not normally transient');
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(weird)
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { baseDelayMs: 50, retryOn: () => true });
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry when a custom retryOn returns false', async () => {
    const transientErr = { status: 503 };
    const fn = jest.fn<Promise<never>, []>().mockRejectedValue(transientErr);

    await expect(withRetry(fn, { retryOn: () => false })).rejects.toBe(transientErr);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('invokes onRetry with attempt #, error, and exponential-backoff delay', async () => {
    const err = { status: 503 };
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('done');
    const onRetry = jest.fn();

    // Math.random()===0 → jitter 0 → delays are 1000*2^0=1000 then 1000*2^1=2000.
    const promise = withRetry(fn, { baseDelayMs: 1000, onRetry });
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toBe('done');

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, err, 1000);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, err, 2000);
  });

  it('caps backoff delay at maxDelayMs', async () => {
    const err = { status: 503 };
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('ok');
    const onRetry = jest.fn();

    // baseDelayMs * 2^0 = 5000 but maxDelayMs caps it at 2000.
    const promise = withRetry(fn, { baseDelayMs: 5000, maxDelayMs: 2000, onRetry });
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, err, 2000);
  });

  it('adds positive jitter when Math.random() > 0', async () => {
    (Math.random as unknown as jest.Mock).mockReturnValue(1); // max jitter
    const err = { status: 503 };
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('ok');
    const onRetry = jest.fn();

    // delay = 1000*2^0 + (1 * 1000 * 0.5) = 1500
    const promise = withRetry(fn, { baseDelayMs: 1000, onRetry });
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');

    expect(onRetry).toHaveBeenCalledWith(1, err, 1500);
  });
});
