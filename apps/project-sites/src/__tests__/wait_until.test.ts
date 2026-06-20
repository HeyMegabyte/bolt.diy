import { safeWaitUntil } from '../lib/wait-until';

/**
 * safeWaitUntil — guards the recurring `c.executionCtx` crash: the getter throws
 * outside a fetch handler (internal/queue/scheduled/test), so unguarded
 * waitUntil crashes the request. The helper schedules when a ctx exists and
 * no-ops (without throwing) when it doesn't.
 */
describe('safeWaitUntil', () => {
  it('schedules the work via executionCtx.waitUntil when a context exists', () => {
    const waitUntil = jest.fn();
    const c = {
      get executionCtx() {
        return { waitUntil };
      },
    } as never;
    const work = Promise.resolve('done');
    safeWaitUntil(c, work);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(work);
  });

  it('does NOT throw when the executionCtx getter throws (no context)', () => {
    const c = {
      get executionCtx(): never {
        throw new Error('This context has no ExecutionContext');
      },
    } as never;
    expect(() => safeWaitUntil(c, Promise.resolve())).not.toThrow();
  });
});
