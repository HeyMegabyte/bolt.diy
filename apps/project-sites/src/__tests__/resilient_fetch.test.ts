/**
 * @module __tests__/resilient_fetch
 * @description Tests for the Effect-based resilient JSON fetch utility:
 * success, typed errors (4xx no-retry, 5xx retry, network retry, parse error),
 * and exhausted-retry behaviour. Uses an injected `fetchImpl` — no real network.
 */
import { Effect, Exit } from 'effect';
import { fetchJson, FetchHttpError, FetchParseError } from '../platform/resilient-fetch.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Run the Effect to a settled Exit so we can assert success OR typed failure. */
const runExit = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromiseExit(eff);

describe('fetchJson (Effect resilient fetch)', () => {
  it('returns the parsed JSON on a 2xx response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ ok: true, n: 42 }));
    const out = await Effect.runPromise(
      fetchJson<{ ok: boolean; n: number }>('https://x/api', {
        fetchImpl: fetchImpl as typeof fetch,
      }),
    );
    expect(out).toEqual({ ok: true, n: 42 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails with a typed FetchHttpError on 404 and does NOT retry (4xx is deterministic)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 404));
    const exit = await runExit(
      fetchJson('https://x/missing', { retries: 3, fetchImpl: fetchImpl as typeof fetch }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = exit.cause._tag === 'Fail' ? exit.cause.error : null;
      expect(err).toBeInstanceOf(FetchHttpError);
      expect((err as FetchHttpError).status).toBe(404);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry on 4xx
  });

  it('retries a 5xx then succeeds', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 503))
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));
    const out = await Effect.runPromise(
      fetchJson<{ recovered: boolean }>('https://x/flaky', {
        retries: 2,
        baseDelayMs: 1,
        fetchImpl: fetchImpl as typeof fetch,
      }),
    );
    expect(out).toEqual({ recovered: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a network throw then exhausts retries with the typed error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const exit = await runExit(
      fetchJson('https://x/down', {
        retries: 2,
        baseDelayMs: 1,
        fetchImpl: fetchImpl as typeof fetch,
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // first try + 2 retries
  });

  it('fails with FetchParseError on an invalid JSON body (not retried)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('<<not json>>', { status: 200 }));
    const exit = await runExit(
      fetchJson('https://x/bad', { retries: 2, fetchImpl: fetchImpl as typeof fetch }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toBeInstanceOf(FetchParseError);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1); // parse errors are not retried
  });
});
