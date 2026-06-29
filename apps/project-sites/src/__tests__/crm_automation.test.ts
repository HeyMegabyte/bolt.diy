/**
 * Pure, never-throws tests for the TW9 lifecycle automation rules engine.
 */
import {
  DEFAULT_RULES,
  matchRules,
  type Cohort,
  type Trigger,
} from '../services/crm_automation.js';

describe('DEFAULT_RULES', () => {
  it('has all 8 lifecycle transitions', () => {
    expect(DEFAULT_RULES).toHaveLength(8);
  });

  it('every rule carries a valid cohort + trigger for when', () => {
    const validCohorts = new Set<Cohort>(['new', 'trial', 'active', 'dormant', 'churned']);
    const validTriggers = new Set<Trigger>([
      'signup',
      'build_complete',
      'payment',
      'payment_failed',
      'inactive_30d',
      'inactive_90d',
    ]);

    for (const rule of DEFAULT_RULES) {
      expect(validCohorts.has(rule.when.cohort)).toBe(true);
      expect(validTriggers.has(rule.when.trigger)).toBe(true);
    }
  });

  it('every rule carries a valid cohort for then.nextCohort', () => {
    const validCohorts = new Set<Cohort>(['new', 'trial', 'active', 'dormant', 'churned']);

    for (const rule of DEFAULT_RULES) {
      expect(validCohorts.has(rule.then.nextCohort)).toBe(true);
    }
  });

  it('every rule has at least one action', () => {
    for (const rule of DEFAULT_RULES) {
      expect(rule.then.actions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every action is a non-empty string', () => {
    for (const rule of DEFAULT_RULES) {
      for (const action of rule.then.actions) {
        expect(typeof action).toBe('string');
        expect(action.length).toBeGreaterThan(0);
      }
    }
  });

  it('is frozen at the array level (cannot push/pop)', () => {
    expect(Object.isFrozen(DEFAULT_RULES)).toBe(true);
    // Object.freeze is shallow — nested objects are not individually frozen.
    // TypeScript's `readonly` modifier and `as const` prevent mutation at
    // compile time, while the array-level freeze prevents structural changes.
    // @ts-expect-error — deliberate mutation test on readonly array
    expect(() => DEFAULT_RULES.push({} as never)).toThrow();
  });
});

describe('matchRules', () => {
  describe('happy path — known transitions', () => {
    const matrix: Array<{
      cohort: Cohort;
      trigger: Trigger;
      expectedNext: Cohort;
      expectedActions: string[];
    }> = [
      {
        cohort: 'new',
        trigger: 'signup',
        expectedNext: 'trial',
        expectedActions: ['tag_free_trial', 'send_welcome_email'],
      },
      {
        cohort: 'trial',
        trigger: 'build_complete',
        expectedNext: 'active',
        expectedActions: ['tag_active', 'send_site_live_notification'],
      },
      {
        cohort: 'active',
        trigger: 'payment',
        expectedNext: 'active',
        expectedActions: ['tag_paid', 'send_receipt'],
      },
      {
        cohort: 'active',
        trigger: 'inactive_30d',
        expectedNext: 'dormant',
        expectedActions: ['tag_dormant_30d', 'send_winback_email'],
      },
      {
        cohort: 'dormant',
        trigger: 'inactive_90d',
        expectedNext: 'churned',
        expectedActions: ['tag_churned', 'send_farewell_email'],
      },
      {
        cohort: 'dormant',
        trigger: 'payment',
        expectedNext: 'active',
        expectedActions: ['tag_reactivated', 'send_welcome_back_email'],
      },
      {
        cohort: 'churned',
        trigger: 'payment',
        expectedNext: 'active',
        expectedActions: ['tag_reactivated', 'send_welcome_back_email'],
      },
      {
        cohort: 'trial',
        trigger: 'payment_failed',
        expectedNext: 'trial',
        expectedActions: ['tag_payment_failed', 'send_payment_reminder'],
      },
    ];

    for (const { cohort, trigger, expectedNext, expectedActions } of matrix) {
      it(`${cohort} + ${trigger} → ${expectedNext}`, () => {
        const result = matchRules(cohort, trigger);
        expect(result).toHaveLength(1);
        expect(result[0].then.nextCohort).toBe(expectedNext);
        expect(result[0].then.actions).toEqual(expectedActions);
      });
    }
  });

  it('returns empty array for unknown combination (does not throw)', () => {
    const result = matchRules('new', 'payment_failed');
    expect(result).toEqual([]);
  });

  it('returns empty array for another unknown combination', () => {
    const result = matchRules('churned', 'inactive_30d');
    expect(result).toEqual([]);
  });

  it('returns empty array for yet another unknown combination', () => {
    const result = matchRules('new', 'inactive_90d');
    expect(result).toEqual([]);
  });

  it('returns empty for a fully impossible combination', () => {
    const result = matchRules('churned', 'signup');
    expect(result).toEqual([]);
  });

  it('accepts a custom rule set', () => {
    const customRules = [
      {
        when: { cohort: 'active' as Cohort, trigger: 'payment' as Trigger },
        then: { nextCohort: 'active' as Cohort, actions: ['custom_action'] },
      },
    ];

    const result = matchRules('active', 'payment', customRules);
    expect(result).toHaveLength(1);
    expect(result[0].then.actions).toEqual(['custom_action']);
  });

  it('returns empty for custom rules that do not match', () => {
    const customRules = [
      {
        when: { cohort: 'active' as Cohort, trigger: 'payment' as Trigger },
        then: { nextCohort: 'active' as Cohort, actions: ['x'] },
      },
    ];

    const result = matchRules('dormant', 'payment', customRules);
    expect(result).toEqual([]);
  });

  it('returns multiple matches when multiple rules match', () => {
    const multiRules = [
      {
        when: { cohort: 'active' as Cohort, trigger: 'payment' as Trigger },
        then: { nextCohort: 'active' as Cohort, actions: ['send_receipt'] },
      },
      {
        when: { cohort: 'active' as Cohort, trigger: 'payment' as Trigger },
        then: { nextCohort: 'premium' as Cohort, actions: ['upgrade_tier'] },
      },
    ];

    const result = matchRules('active', 'payment', multiRules);
    expect(result).toHaveLength(2);
  });

  it('never mutates the original rule set', () => {
    const originalLength = DEFAULT_RULES.length;
    matchRules('new', 'signup');
    expect(DEFAULT_RULES.length).toBe(originalLength);
  });
});
