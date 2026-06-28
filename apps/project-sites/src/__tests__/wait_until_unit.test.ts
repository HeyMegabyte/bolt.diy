import { safeWaitUntil } from '../lib/wait-until.js';

describe('safeWaitUntil', () => {
  it('forwards work to executionCtx.waitUntil when a ctx exists', () => {
    const waitUntil = jest.fn();
    const work = Promise.resolve();
    safeWaitUntil({ executionCtx: { waitUntil } } as any, work);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(work);
  });

  it('never throws when executionCtx getter throws (internal/test invocation)', () => {
    const ctx = {
      get executionCtx(): never {
        throw new Error('no ExecutionContext');
      },
    };
    expect(() => safeWaitUntil(ctx as any, Promise.resolve())).not.toThrow();
  });

  it('does not reject the caller even if the background work rejects', async () => {
    const waitUntil = jest.fn();
    // work must already be error-swallowed by contract; helper never awaits it.
    const work = Promise.reject(new Error('bg')).catch(() => undefined);
    expect(() => safeWaitUntil({ executionCtx: { waitUntil } } as any, work)).not.toThrow();
    await work; // settles cleanly
  });
});
