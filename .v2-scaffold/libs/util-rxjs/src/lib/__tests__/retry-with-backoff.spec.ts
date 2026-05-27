import { describe, expect, it, vi } from 'vitest';
import { defer, throwError, of, firstValueFrom } from 'rxjs';
import { retryWithBackoff } from '../retry-with-backoff.js';

describe('retryWithBackoff', () => {
  it('retries up to `count` times then surfaces the error', async () => {
    let attempts = 0;
    const source$ = defer(() => {
      attempts++;
      return throwError(() => new Error('boom'));
    }).pipe(retryWithBackoff({ count: 2, baseMs: 1, maxMs: 2, jitter: false }));

    await expect(firstValueFrom(source$)).rejects.toThrow('boom');
    expect(attempts).toBe(3); // initial + 2 retries
  });

  it('passes through values after a transient failure', async () => {
    let attempts = 0;
    const source$ = defer(() => {
      attempts++;
      return attempts < 2 ? throwError(() => new Error('transient')) : of('ok');
    }).pipe(retryWithBackoff({ count: 3, baseMs: 1, maxMs: 2, jitter: false }));

    await expect(firstValueFrom(source$)).resolves.toBe('ok');
    expect(attempts).toBe(2);
  });

  it('respects shouldRetry predicate', async () => {
    const shouldRetry = vi.fn(() => false);
    const source$ = defer(() => throwError(() => new Error('nope'))).pipe(
      retryWithBackoff({ count: 5, baseMs: 1, maxMs: 2, shouldRetry })
    );

    await expect(firstValueFrom(source$)).rejects.toThrow('nope');
    // shouldRetry is consulted once on the first failure, then we bail.
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });
});
