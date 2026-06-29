/**
 * Pure typed feature-flag client — shared by admin UI + Worker middleware.
 *
 * Stateless helpers for evaluating D1-backed feature flags.  Every function
 * here is a pure function: same inputs → same output.  No I/O, no env
 * requirement, no side effects.
 *
 * @remarks
 * Rollout is computed with a deterministic FNV-1a hash of the user ID so
 * that the same user always sees (or never sees) a feature regardless of
 * request routing or cache state — no persistent assignment storage needed.
 *
 * @module feature_flag_client
 */

// ───────────── Types ─────────────

export type FlagStage = 'experimental' | 'beta' | 'stable' | 'deprecated' | 'killswitch';

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rollout_percent: number;
  stage: FlagStage;
  description: string;
  owner_email: string;
}

// ───────────── Public API ─────────────

/**
 * Returns `true` when the flag is actively enabled for the given context.
 *
 * {@link isFlagActive} returns `false` when a flag is disabled, when
 * `rollout_percent < 100` and no `userId` is provided (safe fallback for
 * anonymous requests), or when the user falls outside the rollout bucket.
 *
 * @param flag - The feature flag definition (typically from the D1 row or KV
 *   cache).
 * @param userId - Optional authenticated user identifier.  When absent only
 *   flags at 100 % rollout are considered active.
 * @returns `true` when the caller should see the feature.
 *
 * @example
 * const allow = isFlagActive(
 *   { key:'new_checkout', enabled:true, rollout_percent:25, stage:'beta' },
 *   'user_clerk_abc123',
 * );
 * // → true for ~25 % of users, deterministically
 *
 * @example
 * // Anonymous request — only full rollouts pass
 * isFlagActive({ … enabled:true, rollout_percent:50 … });
 * // → false (no userId)
 */
export function isFlagActive(flag: FeatureFlag, userId?: string): boolean {
  if (!flag.enabled) return false;
  if (flag.rollout_percent >= 100) return true;
  if (!userId) return false;
  return userInRollout(userId, flag.rollout_percent);
}

const STAGE_LABELS: Record<FlagStage, string> = {
  beta: 'Beta',
  deprecated: 'Deprecated',
  experimental: 'Experimental',
  killswitch: 'Kill Switch',
  stable: 'Stable',
};

/**
 * Returns a human-readable, capitalised label for a given flag stage.
 *
 * @param stage - The internal stage enum value.
 * @returns A display-friendly label such as `"Kill Switch"` or `"Beta"`.
 *
 * @example
 * stageLabel('killswitch') // → 'Kill Switch'
 * stageLabel('beta')       // → 'Beta'
 */
export function stageLabel(stage: FlagStage): string {
  return STAGE_LABELS[stage];
}

/**
 * Determines whether a user identifier falls within a rollout percentage
 * using a deterministic, fast, non-cryptographic hash.
 *
 * The hash is an FNV-1a 32-bit digest of the user ID string, reduced
 * modulo 100.  This guarantees that the same user always maps to the same
 * bucket without requiring any persistent state, database lookup, or cache.
 *
 * @param userId - An opaque user identifier (Clerk `sub`, UUID, email
 *   address — any unique string).
 * @param rolloutPercent - The rollout threshold between 0 and 100.
 * @returns `true` when the user's hash falls below the rollout threshold.
 *
 * @example
 * userInRollout('user_clerk_abc123', 25) // → true or false, deterministic
 */
export function userInRollout(userId: string, rolloutPercent: number): boolean {
  // FNV-1a 32-bit hash
  let hash = 0x811c9dc5; // offset basis
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // multiply by FNV prime, force unsigned 32-bit
  }
  return hash % 100 < rolloutPercent;
}
