/**
 * Inngest plane (§13) — per-request Env propagation via AsyncLocalStorage.
 *
 * Proves the env context is correct AND concurrency-safe: nested reads resolve,
 * outside-context reads throw, and two interleaved `runWithRequestEnv` frames
 * never bleed into each other (the `state-is-the-enemy` hazard a module-global
 * env holder would have).
 */
import { runWithRequestEnv, getRequestEnv, InngestEnvError } from '../inngest/request-env.js';
import type { Env } from '../types/env.js';

const envA = { TAG: 'A' } as unknown as Env;
const envB = { TAG: 'B' } as unknown as Env;

describe('inngest request-env (ALS)', () => {
  it('getRequestEnv returns the env bound by the enclosing run', () => {
    const seen = runWithRequestEnv(envA, () => getRequestEnv());
    expect(seen).toBe(envA);
  });

  it('throws InngestEnvError outside any run context', () => {
    expect(() => getRequestEnv()).toThrow(InngestEnvError);
  });

  it('resolves across an awaited async boundary inside the run', async () => {
    const seen = await runWithRequestEnv(envA, async () => {
      await Promise.resolve();
      return getRequestEnv();
    });
    expect(seen).toBe(envA);
  });

  it('isolates concurrent contexts (no bleed between interleaved requests)', async () => {
    // Two overlapping serve requests with different env; each must keep its own.
    const [a, b] = await Promise.all([
      runWithRequestEnv(envA, async () => {
        await new Promise((r) => setTimeout(r, 5)); // yield so B interleaves
        return getRequestEnv();
      }),
      runWithRequestEnv(envB, async () => {
        await Promise.resolve();
        return getRequestEnv();
      }),
    ]);
    expect(a).toBe(envA);
    expect(b).toBe(envB);
  });
});
