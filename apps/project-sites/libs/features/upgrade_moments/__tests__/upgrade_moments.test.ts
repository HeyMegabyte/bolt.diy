/**
 * Unit tests for the upgrade_moments feature module.
 *
 * The service core is pure (no env, no I/O), so these tests exercise it
 * directly with no D1/KV stubs. Covers: catalog completeness, eligibility,
 * personalization, schema validity, and the FLAG_KEY contract.
 */

import { describe, it, expect } from '@jest/globals';

describe('upgrade_moments/schemas', () => {
  it('UpgradeTriggerSchema enumerates the six friction points', async () => {
    const { UpgradeTriggerSchema } = await import('../schemas.js');
    expect(UpgradeTriggerSchema.options).toEqual([
      'custom_domain',
      'remove_branding',
      'more_pages',
      'ai_credits',
      'priority_build',
      'analytics_pro',
    ]);
  });

  it('UpgradeContextSchema defaults plan to free', async () => {
    const { UpgradeContextSchema } = await import('../schemas.js');
    const parsed = UpgradeContextSchema.parse({});
    expect(parsed.plan).toBe('free');
  });

  it('UpgradeContextSchema rejects an unknown plan', async () => {
    const { UpgradeContextSchema } = await import('../schemas.js');
    expect(UpgradeContextSchema.safeParse({ plan: 'enterprise' }).success).toBe(false);
  });

  it('UpgradeMomentSchema rejects an empty benefits array', async () => {
    const { UpgradeMomentSchema } = await import('../schemas.js');
    const bad = {
      trigger: 'custom_domain',
      eligible: true,
      headline: 'x',
      body: 'x',
      benefits: [],
      cta_label: 'x',
      cta_url: '/x',
      price_hint: '$5/mo',
      value_metric: 'x',
      dismiss_key: 'k',
    };
    expect(UpgradeMomentSchema.safeParse(bad).success).toBe(false);
  });
});

describe('upgrade_moments/service — getUpgradeMoment', () => {
  it('resolves a valid, eligible moment for a free-plan caller', async () => {
    const { getUpgradeMoment } = await import('../service.js');
    const m = getUpgradeMoment('custom_domain', { plan: 'free' });
    expect(m.eligible).toBe(true);
    expect(m.trigger).toBe('custom_domain');
    expect(m.headline.length).toBeGreaterThan(0);
    expect(m.benefits.length).toBeGreaterThanOrEqual(1);
    expect(m.cta_url).toBe('/admin/billing?upsell=custom_domain');
    expect(m.dismiss_key).toBe('upgrade_moment:custom_domain');
  });

  it('marks a moment ineligible for a pro-plan caller (never nag payers)', async () => {
    const { getUpgradeMoment } = await import('../service.js');
    expect(getUpgradeMoment('remove_branding', { plan: 'pro' }).eligible).toBe(false);
    expect(getUpgradeMoment('remove_branding', { plan: 'starter' }).eligible).toBe(false);
  });

  it('every catalog trigger resolves to a schema-valid moment', async () => {
    const { getUpgradeMoment, ALL_TRIGGERS } = await import('../service.js');
    const { UpgradeMomentSchema } = await import('../schemas.js');
    for (const trigger of ALL_TRIGGERS) {
      const m = getUpgradeMoment(trigger, { plan: 'free' });
      expect(UpgradeMomentSchema.safeParse(m).success).toBe(true);
    }
  });

  it('personalizes the body when businessType is given', async () => {
    const { getUpgradeMoment } = await import('../service.js');
    const m = getUpgradeMoment('custom_domain', { plan: 'free', businessType: 'salon' });
    expect(m.body.startsWith('For a salon, this matters:')).toBe(true);
  });

  it('leaves the body unchanged when businessType is blank', async () => {
    const { getUpgradeMoment } = await import('../service.js');
    const base = getUpgradeMoment('custom_domain', { plan: 'free' });
    const blank = getUpgradeMoment('custom_domain', { plan: 'free', businessType: '   ' });
    expect(blank.body).toBe(base.body);
  });
});

describe('upgrade_moments/service — isMomentEligible', () => {
  it('is true only for the free plan', async () => {
    const { isMomentEligible } = await import('../service.js');
    expect(isMomentEligible('ai_credits', 'free')).toBe(true);
    expect(isMomentEligible('ai_credits', 'starter')).toBe(false);
    expect(isMomentEligible('ai_credits', 'pro')).toBe(false);
  });
});

describe('upgrade_moments/service — listEligibleMoments', () => {
  it('returns all six moments for a free caller', async () => {
    const { listEligibleMoments } = await import('../service.js');
    expect(listEligibleMoments({ plan: 'free' })).toHaveLength(6);
  });

  it('returns none for a paid caller', async () => {
    const { listEligibleMoments } = await import('../service.js');
    expect(listEligibleMoments({ plan: 'pro' })).toHaveLength(0);
    expect(listEligibleMoments({ plan: 'starter' })).toHaveLength(0);
  });

  it('preserves catalog display order', async () => {
    const { listEligibleMoments, ALL_TRIGGERS } = await import('../service.js');
    const order = listEligibleMoments({ plan: 'free' }).map((m) => m.trigger);
    expect(order).toEqual([...ALL_TRIGGERS]);
  });
});

describe('upgrade_moments/service — FLAG_KEY', () => {
  it('FLAG_KEY equals the module slug', async () => {
    const { FLAG_KEY } = await import('../service.js');
    expect(FLAG_KEY).toBe('upgrade_moments');
  });
});
