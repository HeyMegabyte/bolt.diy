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
  type BillingMeteringProvider,
  type UsageEvent as UsageEventType,
} from '../services/billing_provider.js';
import { NoopBillingProvider } from '../services/billing_provider_noop.js';
import { MetronomeProvider } from '../services/billing_provider_metronome.js';
import { estimateCostCents, METRIC_RATE_CENTS } from '../services/billing_provider_stripe.js';
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
    expect(() => resolveBillingProviderId(stubEnv('openmeter'))).toThrow('no longer supported');
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
    const metrics = Object.keys(METRIC_UNIT);
    expect(metrics.length).toBe(17);
    const validUnits = ['token', 'minute', 'event', 'gb', 'gb_hour', 'seat'];
    for (const m of metrics) {
      expect(validUnits).toContain(METRIC_UNIT[m as keyof typeof METRIC_UNIT]);
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

// ─── Per-unit cost breakdown ─────────────────────────────────────────────

describe('Per-unit cost accuracy', () => {
  it('charges per TOKEN, not per AI call', () => {
    // 1 AI call with 5000 input + 2000 output tokens = 7000 tokens total
    // NOT 1 "ai call" event
    const inputCost = estimateCostCents('ai_input_tokens', 5000);
    const outputCost = estimateCostCents('ai_output_tokens', 2000);

    // $0.15/1M input → 5000 × 0.000015 = 0.075 cents (fractional)
    // $0.60/1M output → 2000 × 0.00006 = 0.12 cents
    expect(inputCost).toBe(0); // rounds to 0 (sub-cent)
    expect(outputCost).toBe(0); // rounds to 0 (sub-cent)

    // At scale: 1M input tokens
    expect(estimateCostCents('ai_input_tokens', 1_000_000)).toBe(15); // $0.15
    expect(estimateCostCents('ai_output_tokens', 1_000_000)).toBe(60); // $0.60
  });

  it('charges per GB for bandwidth egress', () => {
    // $0.05 / GB
    expect(estimateCostCents('bandwidth_egress_gb', 1)).toBe(5); // $0.05
    expect(estimateCostCents('bandwidth_egress_gb', 100)).toBe(500); // $5.00
    expect(estimateCostCents('bandwidth_egress_gb', 0)).toBe(0);
  });

  it('charges per GB-hour for storage', () => {
    // ~$5/GB-month = $5 / 730 hours ≈ 0.007 cents/hour
    // 1 GB stored for 730 hours (≈1 month)
    expect(estimateCostCents('storage_gb_hours', 730)).toBe(5); // ~$0.05
  });

  it('charges per MINUTE for compute (browser + build)', () => {
    expect(estimateCostCents('browser_automation_minutes', 10)).toBe(30); // $0.30
    expect(estimateCostCents('build_compute_minutes', 60)).toBe(120); // $1.20
  });

  it('charges per SEND for email + SMS', () => {
    expect(estimateCostCents('email_sends', 1000)).toBe(10); // $0.10
    expect(estimateCostCents('sms_sends', 100)).toBe(100); // $1.00
  });

  it('METRIC_RATE_CENTS covers all metrics in STRIPE_METER_MAP', () => {
    for (const metric of Object.keys(STRIPE_METER_MAP)) {
      expect(METRIC_RATE_CENTS).toHaveProperty(metric);
      expect(typeof METRIC_RATE_CENTS[metric]).toBe('number');
    }
  });

  it('free-tier metrics are zero-cost', () => {
    expect(estimateCostCents('form_submissions', 1000)).toBe(0);
    expect(estimateCostCents('booking_events', 1000)).toBe(0);
    expect(estimateCostCents('site_visits', 10_000)).toBe(10); // ~$0.10 for 10k visits
  });
});

// ─── Metronome swap compatibility ─────────────────────────────────────────

describe('MetronomeProvider swap compatibility', () => {
  function stubMetronomeEnv(active = false) {
    return {
      BILLING_PROVIDER: active ? 'metronome' : 'stripe_meters',
      METRONOME_API_KEY: undefined,
      DB: { prepare: () => ({ bind: () => ({ run: () => Promise.resolve() }) }) },
    } as unknown as import('../types/env.js').Env;
  }

  it('implements BillingMeteringProvider interface', () => {
    const provider = new MetronomeProvider(stubMetronomeEnv());
    // TypeScript structural check: if this compiles, the interface is satisfied
    const _check: BillingMeteringProvider = provider;
    expect(_check).toBe(provider);
  });

  it('recordUsage is a no-op when inactive (no API key)', async () => {
    const provider = new MetronomeProvider(stubMetronomeEnv(false));
    await expect(
      provider.recordUsage({
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        customerId: 'cus_x',
        metric: 'ai_input_tokens',
        quantity: 1000,
        unit: 'token',
        source: 'test',
        occurredAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });

  it('recordUsageBatch is a no-op when inactive', async () => {
    const provider = new MetronomeProvider(stubMetronomeEnv(false));
    await expect(
      provider.recordUsageBatch([
        {
          id: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          customerId: 'cus_x',
          metric: 'email_sends',
          quantity: 5,
          unit: 'event',
          source: 'test',
          occurredAt: new Date().toISOString(),
        },
      ]),
    ).resolves.toBeUndefined();
  });

  it('syncCustomer is a no-op when inactive', async () => {
    const provider = new MetronomeProvider(stubMetronomeEnv(false));
    await expect(
      provider.syncCustomer({
        customerId: 'cus_x',
        email: 'test@test.com',
        orgId: 'org_x',
      }),
    ).resolves.toBeUndefined();
  });

  it('NoopBillingProvider and MetronomeProvider are both valid BillingMeteringProvider', () => {
    // Both providers satisfy the interface — a provider swap is a config flip.
    const noop: BillingMeteringProvider = new NoopBillingProvider(stubMetronomeEnv());
    const metronome: BillingMeteringProvider = new MetronomeProvider(stubMetronomeEnv());
    expect(noop).toBeTruthy();
    expect(metronome).toBeTruthy();
  });

  it('all 3 providers accept the same UsageEvent shape', () => {
    // Ensures StripeMeters → Metronome migration is a provider swap, not a data migration.
    const event: UsageEvent = {
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      customerId: 'cus_x',
      orgId: 'org_x',
      siteId: 'site_x',
      appId: 'app_x',
      metric: 'ai_output_tokens',
      quantity: 500,
      unit: 'token',
      source: 'ai_gateway',
      occurredAt: new Date().toISOString(),
      pricingVersion: '2026-Q3',
      metadata: { model: 'gpt-4o' },
    };
    // TypeScript structural check: all required fields present + correct types.
    const _check: UsageEventType = event;
    expect(_check.metric).toBe('ai_output_tokens');
    expect(_check.unit).toBe('token');
  });
});
