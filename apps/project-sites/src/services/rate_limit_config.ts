/**
 * Rate-limit rule definitions and utilities.
 *
 * @remarks
 * Pure configuration module — no I/O, no env bindings. Defines the rule shape,
 * a builder function, a rule matcher, a config summary helper, and a set of
 * sensible default rules for the worker's route families.
 *
 * @example
 * ```ts
 * const rules = [
 *   buildRule('/health', ['GET'], 60, 60_000),
 *   ...DEFAULT_RULES,
 * ];
 * const summary = configSummary(rules);
 * ```
 */
export interface RateLimitRule {
  /** URL path (glob-style `*` suffix supported for prefix matching). */
  path: string;
  /** HTTP methods this rule applies to. */
  methods: string[];
  /** Maximum number of requests allowed within `windowMs`. */
  maxRequests: number;
  /** Time window in milliseconds. */
  windowMs: number;
  /** Scope of the rate-limit counter. */
  scope: 'global' | 'ip' | 'user' | 'org';
}

/**
 * Build a fully typed {@link RateLimitRule} with defaults.
 *
 * `windowMs` defaults to 60_000 (1 minute) and `scope` defaults to `'ip'`.
 *
 * @param path - URL path pattern
 * @param methods - Allowed HTTP methods (GET, POST, etc.)
 * @param maxRequests - Max requests within the window
 * @param windowMs - Time window in ms (default 60_000)
 * @param scope - Counter scope (default `'ip'`)
 * @returns A fully populated RateLimitRule
 *
 * @example
 * ```ts
 * buildRule('/api/*', ['GET'], 100, 60_000, 'user');
 * buildRule('/health', ['GET'], 60); // uses defaults
 * ```
 */
export function buildRule(
  path: string,
  methods: string[],
  maxRequests: number,
  windowMs: number = 60_000,
  scope: 'global' | 'ip' | 'user' | 'org' = 'ip',
): RateLimitRule {
  return { path, methods, maxRequests, windowMs, scope };
}

/**
 * Check whether a {@link RateLimitRule} matches a given path + method.
 *
 * Supports prefix matching when `rule.path` ends with `*` — e.g. `/api/*`
 * matches `/api/sites`, `/api/billing/checkout`, etc. When the path does
 * NOT end with `*`, an exact match is required.
 *
 * @param rule - The rule to test against
 * @param path - Incoming request path
 * @param method - Incoming HTTP method
 * @returns `true` if the rule applies
 *
 * @example
 * ```ts
 * matchesRule(DEFAULT_RULES[0], '/api/sites', 'GET'); // true
 * matchesRule(DEFAULT_RULES[0], '/health', 'GET');    // false
 * ```
 */
export function matchesRule(rule: RateLimitRule, path: string, method: string): boolean {
  if (!rule.methods.includes(method)) return false;

  if (rule.path.endsWith('*')) {
    return path.startsWith(rule.path.slice(0, -1));
  }
  return path === rule.path;
}

/**
 * Compute aggregate statistics from a set of rate-limit rules.
 *
 * @param rules - The rules to summarise
 * @returns Object with total rule count, a breakdown of maxRequests by method,
 *          and the strictest rule (lowest maxRequests; ties broken by shortest window).
 *
 * @example
 * ```ts
 * configSummary(DEFAULT_RULES);
 * // => { total: 5, byMethod: { GET: 60, POST: 5 }, strictest: { … auth rule … } }
 * ```
 */
export function configSummary(rules: readonly RateLimitRule[]): {
  total: number;
  byMethod: Record<string, number>;
  strictest: RateLimitRule | null;
} {
  const byMethod: Record<string, number> = {};

  for (const rule of rules) {
    for (const method of rule.methods) {
      const current = byMethod[method] ?? Infinity;
      byMethod[method] = Math.min(current, rule.maxRequests);
    }
  }

  let strictest: RateLimitRule | null = null;
  for (const rule of rules) {
    if (
      strictest === null ||
      rule.maxRequests < strictest.maxRequests ||
      (rule.maxRequests === strictest.maxRequests && rule.windowMs < strictest.windowMs)
    ) {
      strictest = rule;
    }
  }

  return { total: rules.length, byMethod, strictest };
}

/**
 * Sensible default rate-limit rules for the worker's route families.
 *
 * | Route family | Limit | Notes |
 * |-------------|-------|-------|
 * | `/health` | 60/min | Health-check pings |
 * | `/api/*` | 300/min | General API requests |
 * | `/api/auth/*` | 5/min | Login/magic-link (brute force) |
 * | `/webhooks/*` | 100/min | Stripe etc. via inbound webhooks |
 * | `/admin/*` | 1000/min | Internal admin tooling |
 */
export const DEFAULT_RULES: readonly RateLimitRule[] = Object.freeze([
  buildRule('/health', ['GET'], 60, 60_000, 'global'),
  buildRule('/api/*', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], 300, 60_000, 'ip'),
  buildRule('/api/auth/*', ['GET', 'POST'], 5, 60_000, 'ip'),
  buildRule('/webhooks/*', ['POST'], 100, 60_000, 'ip'),
  buildRule('/admin/*', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], 1000, 60_000, 'user'),
]);
