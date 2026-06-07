/**
 * Pure feature-flag control-plane logic — no Angular, no I/O. Shared by both
 * control-plane layers (System Administrator + Site Features) so percentage
 * bucketing, dependency/incompatibility validation, evaluation order, and
 * plan-entitlement gating live in ONE tested place.
 *
 * Every export is a pure function with a typed input + output. Unit-tested in
 * `flag-logic.spec.ts` (Karma). No `any`, no boundary casts.
 */

/** Flag lifecycle stage. Mirrors the worker registry's `FlagStage`. */
export type FlagStage =
  | 'experimental'
  | 'beta'
  | 'stable'
  | 'deprecated'
  | 'killswitch';

/** Plan tiers a site owner can be on. Higher index = more entitlements. */
export type PlanTier = 'free' | 'pro' | 'business' | 'enterprise';

const PLAN_RANK: Record<PlanTier, number> = {
  free: 0,
  pro: 1,
  business: 2,
  enterprise: 3,
};

/**
 * Risk class of a flag change. Drives whether a typed-reason confirmation is
 * required before the mutation is allowed.
 */
export type ChangeRisk = 'safe' | 'review' | 'dangerous';

/**
 * Deterministic 0-99 bucket for a (flag, subject) pair via FNV-1a — same input
 * always lands in the same bucket, so a user at rollout 25% who sees the flag
 * keeps seeing it as rollout climbs. Mirrors the worker's SHA-1 bucket intent
 * with a dependency-free hash suitable for the browser + unit tests.
 *
 * @returns integer in [0, 99]
 */
export function bucketFor(flagKey: string, subject: string): number {
  const input = `${flagKey}:${subject}`;
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime multiply, kept in 32-bit unsigned space
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

/**
 * Whether a (flag, subject) is inside a rollout percentage. `0` is never in,
 * `100` is always in, otherwise the stable bucket must be below the percent.
 */
export function isInRollout(
  flagKey: string,
  subject: string,
  rolloutPercent: number,
): boolean {
  const pct = Math.max(0, Math.min(100, Math.round(rolloutPercent)));
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  return bucketFor(flagKey, subject) < pct;
}

/** A flag's resolved on/off considering enabled + killswitch + rollout. */
export function evaluateEnabled(input: {
  enabled: boolean;
  killSwitch: boolean;
  rolloutPercent: number;
  flagKey: string;
  subject: string;
}): boolean {
  if (input.killSwitch) return false;
  if (!input.enabled) return false;
  return isInRollout(input.flagKey, input.subject, input.rolloutPercent);
}

/**
 * A human-readable evaluation trace — the ordered list of decisions that
 * produced the final on/off, for the Expert-mode "why" panel. Stops at the
 * first decisive step.
 */
export interface EvalStep {
  readonly label: string;
  readonly outcome: 'pass' | 'block' | 'final-on' | 'final-off';
  readonly detail: string;
}

export function evaluationTrace(input: {
  enabled: boolean;
  killSwitch: boolean;
  rolloutPercent: number;
  flagKey: string;
  subject: string;
}): EvalStep[] {
  const steps: EvalStep[] = [];
  if (input.killSwitch) {
    steps.push({ label: 'Kill switch', outcome: 'block', detail: 'Active — forces OFF for everyone, ignores rollout.' });
    steps.push({ label: 'Result', outcome: 'final-off', detail: 'OFF (kill switch).' });
    return steps;
  }
  steps.push({ label: 'Kill switch', outcome: 'pass', detail: 'Not active.' });
  if (!input.enabled) {
    steps.push({ label: 'Global enable', outcome: 'block', detail: 'Disabled globally.' });
    steps.push({ label: 'Result', outcome: 'final-off', detail: 'OFF (disabled).' });
    return steps;
  }
  steps.push({ label: 'Global enable', outcome: 'pass', detail: 'Enabled globally.' });
  const pct = Math.max(0, Math.min(100, Math.round(input.rolloutPercent)));
  if (pct >= 100) {
    steps.push({ label: 'Rollout', outcome: 'pass', detail: '100% — everyone.' });
    steps.push({ label: 'Result', outcome: 'final-on', detail: 'ON.' });
    return steps;
  }
  if (pct <= 0) {
    steps.push({ label: 'Rollout', outcome: 'block', detail: '0% — nobody (enable rollout to expose).' });
    steps.push({ label: 'Result', outcome: 'final-off', detail: 'OFF (0% rollout).' });
    return steps;
  }
  const bucket = bucketFor(input.flagKey, input.subject);
  const inside = bucket < pct;
  steps.push({
    label: 'Rollout',
    outcome: inside ? 'pass' : 'block',
    detail: `Subject bucket ${bucket} ${inside ? '<' : '≥'} ${pct}% → ${inside ? 'inside' : 'outside'} rollout.`,
  });
  steps.push({
    label: 'Result',
    outcome: inside ? 'final-on' : 'final-off',
    detail: inside ? 'ON.' : 'OFF (outside rollout bucket).',
  });
  return steps;
}

/**
 * Classify the risk of a proposed change against current state. Dangerous
 * changes require a typed reason + confirmation; review changes warn; safe
 * changes apply directly.
 *
 *  - kill switch ON               → dangerous
 *  - global enable from OFF→ON     → dangerous (exposes to audience)
 *  - rollout jump of ≥ 25 points   → dangerous
 *  - rollout change < 25 points    → review
 *  - global disable / restore      → review
 *  - no-op                         → safe
 */
export function classifyChange(
  current: { enabled: boolean; killSwitch: boolean; rolloutPercent: number },
  next: { enabled?: boolean; killSwitch?: boolean; rolloutPercent?: number },
): ChangeRisk {
  if (next.killSwitch === true && !current.killSwitch) return 'dangerous';
  if (next.enabled === true && !current.enabled) return 'dangerous';
  if (next.rolloutPercent !== undefined) {
    const delta = Math.abs(next.rolloutPercent - current.rolloutPercent);
    if (delta >= 25) return 'dangerous';
    if (delta > 0) return 'review';
  }
  if (next.enabled === false && current.enabled) return 'review';
  if (next.killSwitch === false && current.killSwitch) return 'review';
  return 'safe';
}

/**
 * Validate a set of flag states for dependency + incompatibility coherence.
 * Returns the list of violations (empty = coherent).
 *
 *  - `requires`: flag A needs flag B on. If A is on and B is off → violation.
 *  - `conflictsWith`: A and B cannot both be on. If both on → violation.
 */
export interface FlagConstraint {
  readonly key: string;
  readonly requires?: readonly string[];
  readonly conflictsWith?: readonly string[];
}

export interface ConstraintViolation {
  readonly key: string;
  readonly kind: 'missing-dependency' | 'incompatible';
  readonly other: string;
  readonly message: string;
}

export function validateConstraints(
  enabledByKey: Readonly<Record<string, boolean>>,
  constraints: readonly FlagConstraint[],
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const isOn = (k: string): boolean => enabledByKey[k] === true;
  for (const c of constraints) {
    if (!isOn(c.key)) continue;
    for (const dep of c.requires ?? []) {
      if (!isOn(dep)) {
        violations.push({
          key: c.key,
          kind: 'missing-dependency',
          other: dep,
          message: `${c.key} requires ${dep} to be enabled.`,
        });
      }
    }
    for (const other of c.conflictsWith ?? []) {
      if (isOn(other)) {
        violations.push({
          key: c.key,
          kind: 'incompatible',
          other,
          message: `${c.key} cannot run alongside ${other}.`,
        });
      }
    }
  }
  return violations;
}

/**
 * Site-feature entitlement decision for the owner-facing layer. A feature is
 * available when the site's plan tier meets the feature's required tier.
 *
 * @returns `'available' | 'upgrade-required' | 'addon-required'`
 */
export type EntitlementState = 'available' | 'upgrade-required' | 'addon-required';

export function entitlementFor(input: {
  plan: PlanTier;
  requiredPlan: PlanTier;
  isAddon?: boolean;
}): EntitlementState {
  if (PLAN_RANK[input.plan] >= PLAN_RANK[input.requiredPlan]) return 'available';
  return input.isAddon ? 'addon-required' : 'upgrade-required';
}

/** Plan rank exported for display/sort. */
export function planRank(plan: PlanTier): number {
  return PLAN_RANK[plan];
}
