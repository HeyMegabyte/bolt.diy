/**
 * @module middleware/feature-evaluation
 *
 * @description
 * Real adapter + factory for the §33 OpenFeature evaluation port. Wraps the
 * existing D1 flag engine (`modules/feature_flags`) in the OpenFeature
 * `ResolutionDetails` contract. There is no external service and no env secret —
 * the "provider" delegates to our own `isFlagOn`, so it is always available and
 * needs no gate (see ADR-0033). A future REMOTE OpenFeature provider would slot
 * in here behind an env var without touching call sites.
 *
 * @see platform/feature-evaluation.ts (the port + Fake)
 * @see modules/feature_flags/services.ts (isFlagOn — the wrapped engine)
 */
import type { Env } from '../types/env.js';
import {
  EvaluationContextSchema,
  type EvaluationContext,
  type FeatureEvaluationProvider,
  type ResolutionDetails,
} from '../platform/feature-evaluation.js';
import { isFlagOn, type FlagScope } from '../modules/feature_flags/services.js';

/** Map an OpenFeature evaluation context onto the engine's `FlagScope`. */
function toScope(context?: EvaluationContext): FlagScope {
  if (!context) return {};
  const parsed = EvaluationContextSchema.safeParse(context);
  const ctx = parsed.success ? parsed.data : {};
  return {
    orgId: ctx.orgId,
    siteId: ctx.siteId,
    // OpenFeature's canonical caller-identity field is `targetingKey`; fall back to it for userId.
    userId: ctx.userId ?? ctx.targetingKey,
    anonId: ctx.anonId,
  };
}

/**
 * OpenFeature provider backed by the production D1 flag engine. Delegates boolean
 * evaluation to {@link isFlagOn} and shapes the result as `ResolutionDetails`.
 * Fail-soft: any thrown error returns the caller default with `reason: 'ERROR'`.
 */
export class D1FlagEvaluationProvider implements FeatureEvaluationProvider {
  readonly name = 'projectsites-d1-flags';
  constructor(private readonly env: Env) {}

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context?: EvaluationContext,
  ): Promise<ResolutionDetails<boolean>> {
    try {
      const value = await isFlagOn(this.env, flagKey, toScope(context));
      return {
        value,
        reason: value ? 'TARGETING_MATCH' : 'DISABLED',
        flagMetadata: { source: 'd1-feature-flags' },
      };
    } catch {
      // isFlagOn already fail-closes unknown flags to false; a throw here means a
      // KV/D1 fault — degrade to the caller's default, never propagate.
      return { value: defaultValue, reason: 'ERROR', errorCode: 'GENERAL' };
    }
  }
}

/**
 * Resolve the active feature-evaluation provider. Returns the D1-backed provider —
 * it wraps our own engine, so it is always available (no env gate, unlike the
 * abuse/email/identity ports which front external vendors). Ships DARK in the
 * sense that no handler calls it yet; wiring it in is additive + behavior-neutral.
 *
 * @example
 * const ff = getFeatureEvaluationProvider(c.env);
 * const { value } = await ff.resolveBooleanEvaluation('ai_concierge_widget', false, { siteId });
 */
export function getFeatureEvaluationProvider(env: Env): FeatureEvaluationProvider {
  return new D1FlagEvaluationProvider(env);
}
