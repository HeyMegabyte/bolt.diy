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
 * The Cloudflare Flagship Workers binding (native feature-flag service, OpenFeature
 * provider, public beta 2026). Edge-evaluated in-isolate — no outbound HTTP. Typed
 * structurally because the binding ships from the platform, not an npm package.
 *
 * @see https://developers.cloudflare.com/flagship/
 */
export interface FlagshipBinding {
  getBooleanValue(
    flagKey: string,
    defaultValue: boolean,
    context?: Record<string, unknown>,
  ): Promise<boolean> | boolean;
}

/**
 * OpenFeature provider backed by **Cloudflare Flagship** (native, edge-evaluated).
 * Flagship is the primary source once a flag is defined there; on any miss/fault it
 * falls back to the D1 engine, which stays the admin source-of-truth + the safety
 * net during the migration. Fail-soft end to end — never throws into the caller.
 */
export class FlagshipEvaluationProvider implements FeatureEvaluationProvider {
  readonly name = 'cloudflare-flagship';
  constructor(
    private readonly flagship: FlagshipBinding,
    private readonly fallback: FeatureEvaluationProvider,
  ) {}

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context?: EvaluationContext,
  ): Promise<ResolutionDetails<boolean>> {
    try {
      const ctx = context
        ? {
            targetingKey: context.targetingKey ?? context.userId,
            orgId: context.orgId,
            siteId: context.siteId,
            anonId: context.anonId,
          }
        : undefined;
      const value = await this.flagship.getBooleanValue(flagKey, defaultValue, ctx);
      return {
        value,
        reason: value ? 'TARGETING_MATCH' : 'DISABLED',
        flagMetadata: { source: 'cloudflare-flagship' },
      };
    } catch {
      // Flagship miss / not-yet-defined / edge fault → defer to the D1 engine.
      return this.fallback.resolveBooleanEvaluation(flagKey, defaultValue, context);
    }
  }
}

/**
 * Resolve the active feature-evaluation provider. Prefers **Cloudflare Flagship**
 * (native, in-isolate edge evaluation) when its Workers binding is present, with the
 * D1 engine as the always-available fallback + admin source-of-truth. With no binding
 * it returns the D1 provider unchanged — so this ships DARK until `FLAGSHIP` is bound
 * (additive + behavior-neutral, per ADR-0033).
 *
 * @example
 * const ff = getFeatureEvaluationProvider(c.env);
 * const { value } = await ff.resolveBooleanEvaluation('ai_concierge_widget', false, { siteId });
 */
export function getFeatureEvaluationProvider(env: Env): FeatureEvaluationProvider {
  const d1 = new D1FlagEvaluationProvider(env);
  const flagship = env.FLAGSHIP as FlagshipBinding | undefined;
  if (flagship && typeof flagship.getBooleanValue === 'function') {
    return new FlagshipEvaluationProvider(flagship, d1);
  }
  return d1;
}
