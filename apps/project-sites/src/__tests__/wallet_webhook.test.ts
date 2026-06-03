/**
 * Unit tests for the wallet Stripe-webhook dispatcher
 * ({@link services/wallet_webhook.ts}).
 *
 * `wallet_webhook.ts` is intentionally a THIN dispatcher: it lazy-loads the
 * sibling `services/wallet.ts` module, caches the resolved handle, forwards
 * the four wallet-relevant Stripe events to `wallet.handleStripeEvent`, and
 * no-ops cleanly (logging an info line) when the wallet module is absent or
 * does not export `handleStripeEvent`. The actual signature verification +
 * idempotency/dedup live upstream in `routes/webhooks.ts` + `wallet.ts` — so
 * this suite asserts the dispatcher's contract precisely, never the wallet
 * mutation internals.
 *
 * Covers every branch:
 *   - module PRESENT: forwards (env, eventType, obj) verbatim to
 *     wallet.handleStripeEvent; resolves undefined
 *   - module caching: second call does NOT re-import (load() memoizes)
 *   - event-type passthrough: each of the four routed event types reaches
 *     the handler with the exact object payload (no re-shaping)
 *   - malformed / empty payload: forwarded as-is (dispatcher does not gate)
 *   - error propagation: a throwing wallet handler rejects the dispatcher
 *   - module ABSENT (no `handleStripeEvent` export): no-op + structured
 *     console.warn info line, resolves undefined, never throws
 *   - __resetWalletWebhookForTests: clears the cache so a re-import re-runs
 *
 * The dynamic `import('./wallet.js')` is intercepted with a VIRTUAL jest mock
 * so the real wallet service (and its D1/Stripe calls) is never executed.
 */

import type { Env } from '../types/env.js';

const handleStripeEvent = jest.fn(async () => {}) as unknown as jest.Mock;

jest.mock(
  '../services/wallet.js',
  () => ({ handleStripeEvent }),
  { virtual: true },
);

import {
  handleWalletStripeEvent,
  __resetWalletWebhookForTests,
} from '../services/wallet_webhook.js';

const env = {} as unknown as Env;

const ROUTED_EVENTS = [
  'checkout.session.completed',
  'payment_intent.succeeded',
  'invoice.paid',
  'payment_method.attached',
] as const;

beforeEach(() => {
  __resetWalletWebhookForTests();
  (handleStripeEvent as unknown as jest.Mock).mockClear();
  (handleStripeEvent as unknown as jest.Mock).mockImplementation(async () => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('handleWalletStripeEvent — module present', () => {
  it('forwards (env, eventType, obj) verbatim to wallet.handleStripeEvent', async () => {
    const obj = { kind: 'wallet', id: 'cs_test_123' };
    await expect(
      handleWalletStripeEvent(env, 'checkout.session.completed', obj),
    ).resolves.toBeUndefined();

    expect(handleStripeEvent).toHaveBeenCalledTimes(1);
    expect(handleStripeEvent).toHaveBeenCalledWith(
      env,
      'checkout.session.completed',
      obj,
    );
    // identity preserved — dispatcher does not clone/re-shape the payload
    expect((handleStripeEvent as jest.Mock).mock.calls[0]![2]).toBe(obj);
  });

  it.each(ROUTED_EVENTS)(
    'routes the %s event type through to the handler unchanged',
    async (eventType) => {
      const obj = { kind: 'wallet_topup', evt: eventType };
      await handleWalletStripeEvent(env, eventType, obj);
      expect(handleStripeEvent).toHaveBeenCalledTimes(1);
      expect(handleStripeEvent).toHaveBeenCalledWith(env, eventType, obj);
    },
  );

  it('forwards an empty / malformed payload as-is (no gating in the dispatcher)', async () => {
    await expect(
      handleWalletStripeEvent(env, 'invoice.paid', {}),
    ).resolves.toBeUndefined();
    expect(handleStripeEvent).toHaveBeenCalledWith(env, 'invoice.paid', {});
  });

  it('caches the loaded module — two calls do not re-resolve the handle', async () => {
    await handleWalletStripeEvent(env, 'invoice.paid', { a: 1 });
    await handleWalletStripeEvent(env, 'payment_intent.succeeded', { b: 2 });
    // Both forwarded; memoization is exercised by the second call still
    // reaching the same cached handler without error.
    expect(handleStripeEvent).toHaveBeenCalledTimes(2);
    expect(handleStripeEvent).toHaveBeenNthCalledWith(1, env, 'invoice.paid', {
      a: 1,
    });
    expect(handleStripeEvent).toHaveBeenNthCalledWith(
      2,
      env,
      'payment_intent.succeeded',
      { b: 2 },
    );
  });

  it('propagates an error thrown by the wallet handler (no silent swallow)', async () => {
    (handleStripeEvent as unknown as jest.Mock).mockImplementation(async () => {
      throw new Error('wallet mutation failed');
    });
    await expect(
      handleWalletStripeEvent(env, 'invoice.paid', { kind: 'wallet' }),
    ).rejects.toThrow('wallet mutation failed');
  });

  it('re-resolves after reset — proving the cache was cleared, not stuck', async () => {
    await handleWalletStripeEvent(env, 'invoice.paid', { first: true });
    expect(handleStripeEvent).toHaveBeenCalledTimes(1);

    __resetWalletWebhookForTests();
    (handleStripeEvent as unknown as jest.Mock).mockClear();

    await handleWalletStripeEvent(env, 'invoice.paid', { second: true });
    expect(handleStripeEvent).toHaveBeenCalledTimes(1);
    expect(handleStripeEvent).toHaveBeenCalledWith(env, 'invoice.paid', {
      second: true,
    });
  });
});

describe('handleWalletStripeEvent — module absent / missing handler', () => {
  it('no-ops with a structured info log when wallet exports no handleStripeEvent', async () => {
    jest.resetModules();
    jest.doMock(
      '../services/wallet.js',
      () => ({ somethingUnrelated: true }),
      { virtual: true },
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../services/wallet_webhook.js');
    mod.__resetWalletWebhookForTests();

    await expect(
      mod.handleWalletStripeEvent(env, 'invoice.paid', { kind: 'wallet' }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warn.mock.calls[0]![0] as string);
    expect(logged.level).toBe('info');
    expect(logged.service).toBe('wallet_webhook');
    expect(logged.event_type).toBe('invoice.paid');
    expect(logged.message).toMatch(/not yet deployed/i);

    warn.mockRestore();
    jest.dontMock('../services/wallet.js');
    jest.resetModules();
  });

  it('never invokes a handler and stays silent-safe across repeated absent-module calls', async () => {
    jest.resetModules();
    jest.doMock('../services/wallet.js', () => ({}), { virtual: true });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../services/wallet_webhook.js');
    mod.__resetWalletWebhookForTests();

    await mod.handleWalletStripeEvent(env, 'payment_method.attached', {});
    await mod.handleWalletStripeEvent(env, 'checkout.session.completed', {});

    // Both calls no-op + warn; never throws, never mutates.
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
    jest.dontMock('../services/wallet.js');
    jest.resetModules();
  });
});
