/**
 * Unit tests for feature_flag_client — pure flag evaluation logic.
 *
 * Because every export in `feature_flag_client.ts` is a pure function
 * (same inputs → same outputs, no I/O, no env), these tests never mock
 * anything external.  They simply exercise the deterministic hash, the
 * active-flag gate, and the stage-label mapping.
 */
import {
  type FeatureFlag,
  type FlagStage,
  isFlagActive,
  stageLabel,
  userInRollout,
} from '../services/feature_flag_client.js';

// ───────────── Fixtures ─────────────

const FULL_FLAG: FeatureFlag = {
  key: 'test_feature',
  enabled: true,
  rollout_percent: 100,
  stage: 'beta',
  description: 'A test feature for unit specs',
  owner_email: 'dev@example.com',
};

const DISABLED_FLAG: FeatureFlag = { ...FULL_FLAG, enabled: false };

const PARTIAL_FLAG: FeatureFlag = { ...FULL_FLAG, rollout_percent: 25 };

// ───────────── isFlagActive ─────────────

describe('isFlagActive', () => {
  it('returns true when the flag is enabled at 100% rollout (no userId needed)', () => {
    expect(isFlagActive(FULL_FLAG)).toBe(true);
  });

  it('returns true when the flag is enabled at 100% rollout with a userId', () => {
    expect(isFlagActive(FULL_FLAG, 'user_x')).toBe(true);
  });

  it('returns false when the flag is disabled regardless of rollout', () => {
    expect(isFlagActive(DISABLED_FLAG)).toBe(false);
    expect(isFlagActive(DISABLED_FLAG, 'user_x')).toBe(false);
  });

  it('returns false for a partial rollout when no userId is provided', () => {
    expect(isFlagActive(PARTIAL_FLAG)).toBe(false);
  });

  it('delegates to userInRollout consistently for the same userId', () => {
    const r1 = isFlagActive(PARTIAL_FLAG, 'user_a');
    const r2 = isFlagActive(PARTIAL_FLAG, 'user_a');
    expect(r1).toBe(r2);
  });

  it('treats killswitch as active when enabled + rollout >= 100', () => {
    const ks: FeatureFlag = { ...FULL_FLAG, stage: 'killswitch' };
    expect(isFlagActive(ks)).toBe(true);
  });

  it('treats killswitch as inactive when disabled', () => {
    const ks: FeatureFlag = { ...DISABLED_FLAG, stage: 'killswitch' };
    expect(isFlagActive(ks)).toBe(false);
  });

  it('returns false for anon request with 0% rollout', () => {
    const zero: FeatureFlag = { ...FULL_FLAG, rollout_percent: 0 };
    expect(isFlagActive(zero)).toBe(false);
  });

  it('returns false for anon request with 1% rollout', () => {
    const one: FeatureFlag = { ...FULL_FLAG, rollout_percent: 1 };
    expect(isFlagActive(one)).toBe(false);
  });
});

// ───────────── stageLabel ─────────────

describe('stageLabel', () => {
  const cases: { stage: FlagStage; expected: string }[] = [
    { stage: 'experimental', expected: 'Experimental' },
    { stage: 'beta', expected: 'Beta' },
    { stage: 'stable', expected: 'Stable' },
    { stage: 'deprecated', expected: 'Deprecated' },
    { stage: 'killswitch', expected: 'Kill Switch' },
  ];

  for (const { stage, expected } of cases) {
    it(`returns "${expected}" for stage "${stage}"`, () => {
      expect(stageLabel(stage)).toBe(expected);
    });
  }
});

// ───────────── userInRollout ─────────────

describe('userInRollout', () => {
  it('returns true when rolloutPercent is 100 (everyone in)', () => {
    expect(userInRollout('anything', 100)).toBe(true);
    expect(userInRollout('', 100)).toBe(true);
  });

  it('returns false when rolloutPercent is 0 (nobody in)', () => {
    expect(userInRollout('user_x', 0)).toBe(false);
    expect(userInRollout('user_y', 0)).toBe(false);
  });

  it('is deterministic for the same userId and percentage', () => {
    const results = Array.from({ length: 50 }, () => userInRollout('stable_user_id', 50));
    expect(new Set(results).size).toBe(1);
  });

  it('distributes distinct user IDs roughly evenly at 50% rollout', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `user_${i}`);
    const inRollout = ids.filter((id) => userInRollout(id, 50)).length;
    // Expect between 35 % and 65 % coverage with 1000 samples
    expect(inRollout).toBeGreaterThan(300);
    expect(inRollout).toBeLessThan(700);
  });

  it('handles an empty-string userId without throwing', () => {
    expect(() => userInRollout('', 50)).not.toThrow();
  });

  it('handles a very long userId consistently', () => {
    const long = 'x'.repeat(1000);
    const r1 = userInRollout(long, 50);
    const r2 = userInRollout(long, 50);
    expect(r1).toBe(r2);
  });

  it('handles a userId with special characters', () => {
    const special = 'user@domain.com!_#abc-xyz';
    expect(() => userInRollout(special, 30)).not.toThrow();
  });

  it('produces different buckets for different rollout percentages', () => {
    // At 0% every user is out; at 100% every user is in.
    expect(userInRollout('some_user', 0)).toBe(false);
    expect(userInRollout('some_user', 100)).toBe(true);
  });

  it('the same userId is consistently in or out across multiple calls at 25%', () => {
    const id = 'checkout_user_42';
    const results = Array.from({ length: 30 }, () => userInRollout(id, 25));
    expect(new Set(results).size).toBe(1);
  });
});
