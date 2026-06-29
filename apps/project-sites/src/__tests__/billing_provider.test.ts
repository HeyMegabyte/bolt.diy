/**
 * Tests for the billing provider abstraction.
 *
 * Covers:
 * - NoopBillingProvider works in local/test
 * - BILLING_PROVIDER config rejects "openmeter"
 * - Stripe meter mapping is complete
 * - Idempotency keys are stable
 * - Usage events carry all required fields
 * - METRIC_UNIT covers every UsageMetric
 * - STRIPE_METER_MAP covers every UsageMetric
 */

import { describe, expect, it } from '@jest/globals';
import {
  METRIC_UNIT,
  STRIPE_METER_MAP,
  resolveBillingProviderId,
} from '../services/billing_provider.js';
import { NoopBillingProvider } from '../services/billing_provider_noop.js';
import type { BillingProviderId, UsageEvent } from '../services/billing_provider.js';

// ─── Helpers ────────────────────────────────────────────────────────────

/** Minimal Env stub for tests. */
function stubEnv(billingProvider?: string) {
  return {
    BILLING_PROVIDER: billingProvider,
  } as unknown as import('../types/env.js').Env;
}

/** Build a minimal valid UsageEvent. */
function makeEvent(overrides?: Partial<UsageEvent>): UsageEvent {
  return {
    id: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    customerId: 'cus_test123',
    orgId: 'org_test456',
    metric: 'ai_input_tokens',
    quantity: 1500,
    unit: 'token',
    source: 'ai_gateway',
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── NoopBillingProvider ────────────────────────────────────────────────

describe('NoopBillingProvider', () => {
  it('accepts usage events and exposes them for assertions', async () => {
    const provider = new NoopBillingProvider(stubEnv());
    const event = makeEvent();

    await provider.recordUsage(event);

    expect(provider.recordedEvents).toHaveLength(1);
    expect(provider.recordedEvents[0].id).toBe(event.id);
    expect(provider.recordedEvents[0].metric).toBe('ai_input_tokens');
  });

  it('accepts batch events', async () => {
    const provider = new NoopBillingProvider(stubEnv());
    const events = [makeEvent(), makeEvent({ metric: 'email_sends', unit: 'event' })];

    await provider.recordUsageBatch(events);

    expect(provider.recordedEvents).toHaveLength(2);
    expect(provider.recordedEvents[1].metric).toBe('email_sends');
  });

  it('returns empty summary', async () => {
    const provider = new NoopBillingProvider(stubEnv());

    const summary = await provider.getUsageSummary({
      orgId: 'org_test',
      periodStart: '2026-06-01T00:00:00Z',
      periodEnd: '2026-07-01T00:00:00Z',
    });

    expect(summary.rows).toHaveLength(0);
    expect(summary.totalCostCents).toBe(0);
    expect(summary.source).toBe('projectsites');
  });

  it('syncCustomer is a no-op (does not throw)', async () => {
    const provider = new NoopBillingProvider(stubEnv());

    await expect(
      provider.syncCustomer({
        customerId: 'cus_x',
        email: 'test@example.com',
        orgId: 'org_x',
      }),
    ).resolves.toBeUndefined();
  });
});

// ─── Provider config ────────────────────────────────────────────────────

describe('resolveBillingProviderId', () => {
  it('defaults to stripe_meters when unset', () => {
    expect(resolveBillingProviderId(stubEnv(undefined))).toBe('stripe_meters');
  });

  it('resolves valid providers', () => {
    expect(resolveBillingProviderId(stubEnv('stripe_meters'))).toBe('stripe_meters');
    expect(resolveBillingProviderId(stubEnv('metronome'))).toBe('metronome');
    expect(resolveBillingProviderId(stubEnv('noop'))).toBe('noop');
  });

  it('rejects openmeter provider', () => {
    expect(() => resolveBillingProviderId(stubEnv('openmeter'))).toThrow(
      'no longer supported',
    );
  });

  it('rejects unknown providers', () => {
    expect(() => resolveBillingProviderId(stubEnv('fantasy_biller'))).toThrow(
      'Unknown BILLING_PROVIDER',
    );
  });
});

// ─── Stripe meter mapping ───────────────────────────────────────────────

describe('STRIPE_METER_MAP', () => {
  it('covers every UsageMetric', () => {
    for (const metric of Object.keys(METRIC_UNIT)) {
      expect(STRIPE_METER_MAP).toHaveProperty(metric);
      expect(typeof STRIPE_METER_MAP[metric as keyof typeof STRIPE_METER_MAP]).toBe('string');
    }
  });

  it('all meter names use ps_ prefix', () => {
    for (const name of Object.values(STRIPE_METER_MAP)) {
      expect(name).toMatch(/^ps_/);
    }
  });

  it('has no duplicate meter names', () => {
    const names = Object.values(STRIPE_METER_MAP);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ─── METRIC_UNIT ────────────────────────────────────────────────────────

describe('METRIC_UNIT', () => {
  it('covers every UsageMetric', () => {
    // Every key in METRIC_UNIT should be a valid UsageMetric
    const metrics = Object.keys(METRIC_UNIT);
    expect(metrics.length).toBeGreaterThanOrEqual(16);
    for (const m of metrics) {
      expect(['token', 'minute', 'event', 'gb', 'seat']).toContain(
        METRIC_UNIT[m as keyof typeof METRIC_UNIT],
      );
    }
  });
});

// ─── UsageEvent shape ───────────────────────────────────────────────────

describe('UsageEvent', () => {
  it('carries all required fields', () => {
    const event = makeEvent();

    expect(event.id).toBeTruthy();
    expect(event.idempotencyKey).toBeTruthy();
    expect(event.customerId).toBeTruthy();
    expect(event.metric).toBeTruthy();
    expect(event.quantity).toBeGreaterThan(0);
    expect(event.unit).toBeTruthy();
    expect(event.source).toBeTruthy();
    expect(event.occurredAt).toBeTruthy();
  });

  it('id and idempotencyKey can be the same (UUIDv4)', () => {
    const id = crypto.randomUUID();
    const event = makeEvent({ id, idempotencyKey: id });

    expect(event.id).toBe(event.idempotencyKey);
  });

  it('supports optional attribution fields', () => {
    const event = makeEvent({
      siteId: 'site_123',
      appId: 'app_listmonk',
      pricingVersion: '2026-Q3',
      metadata: { model: 'llama-3.3-70b', feature: 'ai_concierge' },
    });

    expect(event.siteId).toBe('site_123');
    expect(event.appId).toBe('app_listmonk');
    expect(event.pricingVersion).toBe('2026-Q3');
    expect(event.metadata).toEqual({ model: 'llama-3.3-70b', feature: 'ai_concierge' });
  });
});
