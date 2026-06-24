/**
 * @module platform/feature-evaluation
 *
 * @description
 * OpenFeature-shaped feature-flag EVALUATION port (convergence §33, OpenFeature).
 * ProjectSites already owns a complete flag engine (`modules/feature_flags`:
 * D1 `flag_overrides` + KV cache + registry + admin UI + rollout hashing). Per the
 * include-list protocol we do NOT replace it with the OpenFeature vendor SDK —
 * instead this port exposes the existing engine through the OpenFeature provider
 * CONTRACT (the standard `ResolutionDetails` evaluation shape), zero new deps,
 * Workers-native. App code that wants the vendor-neutral evaluation API
 * (value + reason + variant + flagMetadata) calls a {@link FeatureEvaluationProvider}
 * instead of the bare `isFlagOn` boolean.
 *
 * Ports-and-adapters: this file is the pure port (interface + Fake). The real
 * adapter over the D1 engine + the `getFeatureEvaluationProvider(env)` factory live
 * in `middleware/feature-evaluation.ts` (mirrors how `platform/abuse.ts` pairs with
 * `middleware/abuse.ts`). Ships DARK: nothing calls it yet — no behavior change.
 *
 * @see modules/feature_flags/services.ts (isFlagOn — the engine this wraps)
 * @see middleware/feature-evaluation.ts (D1 adapter + factory)
 * @see docs/adr/0033-openfeature-provider-over-d1-flags.md
 */
import { z } from 'zod';

/**
 * OpenFeature-standard evaluation reasons (the subset the D1 engine can produce).
 * - `TARGETING_MATCH` — resolved on (override / rollout bucket hit).
 * - `DISABLED` — flag resolved off.
 * - `DEFAULT` — caller's default returned (Fake provider / unknown to a static map).
 * - `ERROR` — evaluation threw; the caller default was returned.
 */
export type EvaluationReason = 'TARGETING_MATCH' | 'DISABLED' | 'DEFAULT' | 'STATIC' | 'CACHED' | 'ERROR';

/** OpenFeature error codes (subset). */
export type EvaluationErrorCode = 'FLAG_NOT_FOUND' | 'TYPE_MISMATCH' | 'GENERAL';

/**
 * OpenFeature evaluation context. Maps onto the engine's `FlagScope`
 * (`targetingKey` is OpenFeature's canonical caller-identity field → `userId`).
 */
export const EvaluationContextSchema = z
  .object({
    targetingKey: z.string().optional(),
    orgId: z.string().optional(),
    siteId: z.string().optional(),
    userId: z.string().optional(),
    anonId: z.string().optional(),
  })
  .strict();

export type EvaluationContext = z.infer<typeof EvaluationContextSchema>;

/** OpenFeature-standard resolution result. */
export interface ResolutionDetails<T> {
  readonly value: T;
  readonly reason: EvaluationReason;
  readonly variant?: string;
  readonly errorCode?: EvaluationErrorCode;
  readonly flagMetadata?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Vendor-neutral feature-flag evaluation provider (OpenFeature provider contract,
 * boolean slice — the only flag type the D1 engine models today).
 */
export interface FeatureEvaluationProvider {
  /** Provider name for diagnostics (OpenFeature `metadata.name`). */
  readonly name: string;
  /**
   * Resolve a boolean flag. MUST fail soft: on any error return `defaultValue`
   * with `reason: 'ERROR'` — never throw into the caller.
   */
  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context?: EvaluationContext,
  ): Promise<ResolutionDetails<boolean>>;
}

/**
 * Deterministic provider for tests + no-engine local mode — resolves from a
 * static map, falling back to the caller default with `reason: 'DEFAULT'`.
 *
 * @example
 * const p = new FakeFeatureEvaluationProvider({ ai_concierge_widget: true });
 * await p.resolveBooleanEvaluation('ai_concierge_widget', false); // { value: true, reason: 'STATIC' }
 * await p.resolveBooleanEvaluation('unknown', false);             // { value: false, reason: 'DEFAULT' }
 */
export class FakeFeatureEvaluationProvider implements FeatureEvaluationProvider {
  readonly name = 'fake-feature-evaluation';
  constructor(private readonly flags: Readonly<Record<string, boolean>> = {}) {}
  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
  ): Promise<ResolutionDetails<boolean>> {
    if (Object.prototype.hasOwnProperty.call(this.flags, flagKey)) {
      return { value: this.flags[flagKey], reason: 'STATIC' };
    }
    return { value: defaultValue, reason: 'DEFAULT' };
  }
}
