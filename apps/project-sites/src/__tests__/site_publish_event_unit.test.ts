/**
 * Unit tests for site_event_dispatch.ts — pure orchestration, zero I/O.
 *
 * NOTE: site_publish_event.test.ts already thoroughly covers buildSitePublishedEvent
 * and sitePublishedScope, so this file targets the nearest clearly-PURE untested
 * export: handleSiteEvent in site_event_dispatch.ts.  All deps are injected, making
 * this a zero-mock, zero-network test of the arm-isolation logic.
 */
import { handleSiteEvent } from '../services/site_event_dispatch.js';
import type { SiteEventDeps, SiteEventResult, ArmResult } from '../services/site_event_dispatch.js';
import type { DispatchOutcome } from '../services/webhook_dispatch.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_EVENT = { type: 'site.published', payload: { siteId: 'site-abc', version: 'v1' } };

function makeOutcome(overrides: Partial<DispatchOutcome> = {}): DispatchOutcome {
  return { delivered: 1, failed: 0, skipped: 0, attempts: 1, ...overrides };
}

function isErrorArm(arm: ArmResult<unknown>): arm is { error: string } {
  return typeof (arm as { error?: unknown }).error === 'string';
}

// ---------------------------------------------------------------------------
// handleSiteEvent — happy path (webhook arm delivers successfully)
// ---------------------------------------------------------------------------

describe('handleSiteEvent — successful webhook delivery', () => {
  it('returns the DispatchOutcome from the webhook arm when it resolves', async () => {
    const outcome = makeOutcome();
    const deps: SiteEventDeps = {
      dispatchWebhooks: () => Promise.resolve(outcome),
    };

    const result: SiteEventResult = await handleSiteEvent(deps, TEST_EVENT);

    expect(isErrorArm(result.webhooks)).toBe(false);
    expect(result.webhooks).toEqual(outcome);
  });

  it('passes the event through to the webhook arm unchanged', async () => {
    let captured: { type: string; payload: unknown } | null = null;
    const deps: SiteEventDeps = {
      dispatchWebhooks: (event) => {
        captured = event;
        return Promise.resolve(makeOutcome());
      },
    };

    await handleSiteEvent(deps, TEST_EVENT);

    expect(captured).toEqual(TEST_EVENT);
  });

  it('sets the webhook arm result when delivered=0 (all skipped)', async () => {
    const outcome = makeOutcome({ delivered: 0, skipped: 3, attempts: 0 });
    const deps: SiteEventDeps = {
      dispatchWebhooks: () => Promise.resolve(outcome),
    };

    const result = await handleSiteEvent(deps, TEST_EVENT);

    expect(result.webhooks).toEqual(outcome);
  });
});

// ---------------------------------------------------------------------------
// handleSiteEvent — arm failure isolation
// ---------------------------------------------------------------------------

describe('handleSiteEvent — webhook arm throws (arm isolation)', () => {
  it('returns { error } instead of throwing when the arm rejects with an Error', async () => {
    const deps: SiteEventDeps = {
      dispatchWebhooks: () => Promise.reject(new Error('D1 unavailable')),
    };

    const result = await handleSiteEvent(deps, TEST_EVENT);

    expect(isErrorArm(result.webhooks)).toBe(true);
    expect((result.webhooks as { error: string }).error).toBe('D1 unavailable');
  });

  it('returns { error: "arm_failed" } when the arm rejects with a non-Error value', async () => {
    const deps: SiteEventDeps = {
      // eslint-disable-next-line prefer-promise-reject-errors
      dispatchWebhooks: () => Promise.reject('string_rejection'),
    };

    const result = await handleSiteEvent(deps, TEST_EVENT);

    expect(isErrorArm(result.webhooks)).toBe(true);
    expect((result.webhooks as { error: string }).error).toBe('arm_failed');
  });

  it('DOES propagate a synchronous throw to the caller (allSettled only catches async rejections)', async () => {
    // Promise.allSettled([deps.dispatchWebhooks(event)]) evaluates its argument
    // synchronously first.  A sync throw in the dep fires before allSettled
    // receives any promise, so it escapes handleSiteEvent as an uncaught exception.
    const deps: SiteEventDeps = {
      dispatchWebhooks: () => { throw new Error('sync throw'); },
    };

    await expect(handleSiteEvent(deps, TEST_EVENT)).rejects.toThrow('sync throw');
  });

  it('isolates an ASYNC rejection in the arm (the allSettled guarantee)', async () => {
    // This is the actual isolation allSettled provides: a returned rejected promise
    // is caught and converted to { error } instead of propagating.
    const deps: SiteEventDeps = {
      dispatchWebhooks: () => Promise.reject(new Error('async rejection')),
    };

    const result = await handleSiteEvent(deps, TEST_EVENT);

    expect(isErrorArm(result.webhooks)).toBe(true);
    expect((result.webhooks as { error: string }).error).toBe('async rejection');
  });
});

// ---------------------------------------------------------------------------
// handleSiteEvent — return shape contract
// ---------------------------------------------------------------------------

describe('handleSiteEvent — return shape', () => {
  it('always returns an object with a "webhooks" property', async () => {
    const deps: SiteEventDeps = {
      dispatchWebhooks: () => Promise.resolve(makeOutcome()),
    };

    const result = await handleSiteEvent(deps, TEST_EVENT);

    expect(result).toHaveProperty('webhooks');
  });

  it('webhooks is exactly the DispatchOutcome when the arm succeeds', async () => {
    const outcome: DispatchOutcome = { delivered: 2, failed: 1, skipped: 0, attempts: 4 };
    const deps: SiteEventDeps = {
      dispatchWebhooks: () => Promise.resolve(outcome),
    };

    const result = await handleSiteEvent(deps, TEST_EVENT);

    expect(result.webhooks).toStrictEqual(outcome);
  });

  it('different event types are forwarded correctly', async () => {
    const events = [
      { type: 'form.submitted', payload: { formId: 'f1' } },
      { type: 'site.deleted', payload: null },
      { type: 'build.started', payload: { version: 'v2' } },
    ];
    for (const event of events) {
      let captured: typeof event | null = null;
      const deps: SiteEventDeps = {
        dispatchWebhooks: (e) => {
          captured = e as typeof event;
          return Promise.resolve(makeOutcome());
        },
      };
      await handleSiteEvent(deps, event);
      expect(captured).toEqual(event);
    }
  });
});
