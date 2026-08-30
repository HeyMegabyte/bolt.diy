/**
 * Stage 4.1 — buildFunctionsEnv: the scoped-env shim every user handler receives.
 *
 * Parses the deploy-time `__PS_SECRETS_JSON` binding into a frozen `env.SECRETS`,
 * STRIPS internal `__PS_*` bindings so they never reach user code (the seam the
 * later env.KV/R2/AI/DATA shims plug into), and passes the rest through. Fail-soft
 * on a malformed/absent/non-object blob (→ empty SECRETS, never a throw). Pure — no I/O.
 */
import { buildFunctionsEnv } from '../runtime.js';

describe('buildFunctionsEnv', () => {
  it('parses __PS_SECRETS_JSON into env.SECRETS', () => {
    const env = buildFunctionsEnv({
      __PS_SECRETS_JSON: JSON.stringify({ API_KEY: 'x', TOKEN: 'y' }),
    });
    expect(env.SECRETS).toEqual({ API_KEY: 'x', TOKEN: 'y' });
  });

  it('strips internal __PS_* bindings (they never reach user code)', () => {
    const env = buildFunctionsEnv({ __PS_SECRETS_JSON: '{"K":"v"}', PUBLIC_VAR: 'ok' });
    expect(env.__PS_SECRETS_JSON).toBeUndefined();
    expect(env.PUBLIC_VAR).toBe('ok');
  });

  it('freezes env.SECRETS (user code cannot mutate it)', () => {
    const env = buildFunctionsEnv({ __PS_SECRETS_JSON: '{"K":"v"}' });
    expect(Object.isFrozen(env.SECRETS)).toBe(true);
  });

  it('yields an empty SECRETS when the binding is absent', () => {
    expect(buildFunctionsEnv({ SOME: 'thing' }).SECRETS).toEqual({});
  });

  it('fail-soft: a malformed blob yields empty SECRETS, never throws', () => {
    expect(buildFunctionsEnv({ __PS_SECRETS_JSON: 'not json {' }).SECRETS).toEqual({});
  });

  it('ignores a non-object JSON blob (array / primitive → empty SECRETS)', () => {
    expect(buildFunctionsEnv({ __PS_SECRETS_JSON: '[1,2,3]' }).SECRETS).toEqual({});
    expect(buildFunctionsEnv({ __PS_SECRETS_JSON: '"str"' }).SECRETS).toEqual({});
  });

  it('tolerates a non-object env (null / undefined → { SECRETS: {} })', () => {
    expect(buildFunctionsEnv(null).SECRETS).toEqual({});
    expect(buildFunctionsEnv(undefined).SECRETS).toEqual({});
  });

  it('passes non-internal bindings through unchanged (KV/R2/etc. land here later)', () => {
    const kv = { get: () => undefined };
    const env = buildFunctionsEnv({ MY_KV: kv, __PS_SECRETS_JSON: '{}' });
    expect(env.MY_KV).toBe(kv);
  });
});
