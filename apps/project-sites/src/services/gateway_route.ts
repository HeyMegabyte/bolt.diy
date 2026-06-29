/**
 * @module services/gateway_route
 *
 * @description
 * Pure AI Gateway route configuration builder for LLM provider routing. Provides
 * a typed domain model for provider+model pairs with priority, weight-based load
 * distribution, and a fallback chain, plus a resolver that matches a requested
 * model string against the route table by exact match or prefix.
 *
 * Pure + total — no I/O, no clock, no deps beyond the type system. Used by the
 * AI gateway module to select the upstream endpoint for completion calls.
 *
 * @see services/ai_gateway.ts
 */

/** Supported AI providers for the gateway route table. */
export type AiProvider = 'openai' | 'anthropic' | 'deepseek' | 'workers-ai' | 'google';

/**
 * A single gateway route: which provider serves which model, at what priority
 * and traffic weight, with an optional fallback provider.
 */
export interface GatewayRoute {
  /** The upstream provider identifier. */
  readonly provider: AiProvider;
  /** The model identifier (exact name or prefix pattern). */
  readonly model: string;
  /**
   * Resolution priority — higher wins when multiple routes match the same
   * requested model. Ties are broken by weight.
   */
  readonly priority: number;
  /**
   * Traffic weight for weighted-round-robin among routes at the same priority
   * that match the same model. Higher = more traffic.
   */
  readonly weight: number;
  /**
   * Optional fallback provider when this route's provider is unreachable or
   * returns an error. `null` means no fallback — fail closed.
   */
  readonly fallback: AiProvider | null;
}

/**
 * Build a single GatewayRoute with sensible defaults.
 *
 * @param provider - The upstream AI provider.
 * @param model - The model identifier string (e.g. `'gpt-4o'`, `'claude-sonnet-4-6'`).
 * @param priority - Resolution priority (default `10`). Higher = preferred.
 * @param weight - Traffic weight (default `1`). Higher = more traffic in weighted distribution.
 * @param fallback - Fallback provider when the primary is unreachable (default `null`).
 * @returns A fully populated {@link GatewayRoute} object.
 *
 * @example
 * ```ts
 * buildRoute('anthropic', 'claude-sonnet-4-6');
 * // → { provider: 'anthropic', model: 'claude-sonnet-4-6', priority: 10, weight: 1, fallback: null }
 *
 * buildRoute('deepseek', 'deepseek-chat', 5, 'openai');
 * // → { provider: 'deepseek', model: 'deepseek-chat', priority: 5, weight: 1, fallback: 'openai' }
 * ```
 */
export function buildRoute(
  provider: AiProvider,
  model: string,
  priority: number = 10,
  fallback: AiProvider | null = null,
): GatewayRoute {
  return { fallback, model, priority, provider, weight: 1 };
}

/**
 * Resolve a requested model string against a route table, returning the
 * highest-priority matching route or `null` when no route matches.
 *
 * Matching logic:
 * 1. Exact match on `model` wins immediately.
 * 2. Prefix match — the route's model is a prefix of the requested model
 *    (e.g. route `'claude'` matches requested `'claude-sonnet-4-6'`).
 * 3. Among multiple matches, highest `priority` wins.
 * 4. Ties at the same priority are broken by highest `weight`.
 *
 * @param routes - Readonly ordered list of {@link GatewayRoute} entries.
 * @param requestedModel - The model string the caller wants to use.
 * @returns The best-matching route, or `null` when none match.
 *
 * @example
 * ```ts
 * const routes = [
 *   buildRoute('anthropic', 'claude', 10),
 *   buildRoute('openai', 'gpt-4o', 10),
 *   buildRoute('deepseek', 'deepseek', 5, 'openai'),
 * ];
 * resolveRoute(routes, 'claude-sonnet-4-6');
 * // → { provider: 'anthropic', model: 'claude', priority: 10, weight: 1, fallback: null }
 * ```
 */
export function resolveRoute(
  routes: readonly GatewayRoute[],
  requestedModel: string,
): GatewayRoute | null {
  const matches: GatewayRoute[] = [];

  for (const route of routes) {
    if (requestedModel === route.model) {
      // Exact match — collect it; continue scanning (a higher-priority exact
      // match could come later in the array).
      matches.push(route);
    } else if (route.model.length > 0 && requestedModel.startsWith(route.model)) {
      // Prefix match — route.model is a prefix of the requested string.
      matches.push(route);
    }
  }

  if (matches.length === 0) return null;

  // Sort descending: highest priority first, then highest weight as tiebreaker.
  return matches.sort((a, b) => b.priority - a.priority || b.weight - a.weight)[0];
}

/**
 * The default gateway route table for project-sites.
 *
 * | Priority | Provider     | Model      | Fallback  | Role          |
 * |----------|-------------|------------|-----------|---------------|
 * | 10       | openai      | gpt-4o     | —         | Premium       |
 * | 10       | anthropic   | claude     | —         | Premium       |
 * | 5        | deepseek    | deepseek   | openai    | Mid-grade     |
 * | 1        | workers-ai  | llama      | —         | Instant/free  |
 */
export const DEFAULT_ROUTES: readonly GatewayRoute[] = [
  buildRoute('openai', 'gpt-4o', 10),
  buildRoute('anthropic', 'claude', 10),
  buildRoute('deepseek', 'deepseek', 5, 'openai'),
  buildRoute('workers-ai', 'llama', 1),
] as const;
