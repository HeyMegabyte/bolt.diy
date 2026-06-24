/**
 * @module platform/abuse
 *
 * @description
 * App-aware abuse-protection PORT (convergence §48, Arcjet). This is the layer
 * ABOVE the CF-native KV rate limiter (`middleware/rate_limit.ts`): it makes
 * tenant/plan/kind-aware allow|deny decisions (bot detection, suspicious-signup,
 * AI-budget protection, public-form abuse) that a flat per-IP rate limit can't.
 *
 * Ports-and-adapters: the real Arcjet adapter sits behind the `ARCJET_KEY` env
 * gate; with no key the factory returns {@link AllowAllAbuseProvider} so the app
 * degrades OPEN (an abuse-service outage or unconfigured env must NEVER block
 * legitimate traffic — the CF rate limiter still protects). Fake provider for
 * tests + no-vendor local mode.
 *
 * @see middleware/abuse.ts (getAbuseProvider factory + requireNotAbusive middleware)
 * @see middleware/rate_limit.ts (the CF-native per-IP limiter this complements)
 */

/** The surface being protected — drives which Arcjet rules apply. */
export type AbuseKind = 'signup' | 'login' | 'claim' | 'form' | 'ai-generate' | 'api' | 'default';

/** Request context an {@link AbuseProvider} decides on. */
export interface AbuseContext {
  /** Caller IP (CF-Connecting-IP), or null when unavailable. */
  readonly ip: string | null;
  /** Request path, for per-route rules. */
  readonly path: string;
  /** Surface kind — selects the rule set. */
  readonly kind: AbuseKind;
  readonly userId?: string | null;
  readonly tenantId?: string | null;
  readonly plan?: string | null;
}

/** The allow/deny verdict. */
export interface AbuseDecision {
  readonly allow: boolean;
  /** Machine reason when denied: `rate_limited` | `bot` | `suspicious` | `shield`. */
  readonly reason?: string;
  /** Seconds to wait before retrying, when the provider supplies it. */
  readonly retryAfterSec?: number;
}

/** App-aware abuse-protection port (§48). */
export interface AbuseProvider {
  decide(ctx: AbuseContext): Promise<AbuseDecision>;
}

/**
 * Deterministic provider for tests + no-vendor local mode — returns a fixed
 * verdict (allow by default).
 *
 * @example new FakeAbuseProvider({ allow: false, reason: 'bot', retryAfterSec: 60 })
 */
export class FakeAbuseProvider implements AbuseProvider {
  constructor(private readonly verdict: AbuseDecision = { allow: true }) {}
  async decide(): Promise<AbuseDecision> {
    return this.verdict;
  }
}

/**
 * Fail-OPEN provider used when Arcjet is unconfigured — allows everything. The
 * CF-native rate limiter remains the floor; the app must not block on a missing
 * abuse vendor.
 */
export class AllowAllAbuseProvider implements AbuseProvider {
  async decide(): Promise<AbuseDecision> {
    return { allow: true };
  }
}
