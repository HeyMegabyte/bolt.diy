/**
 * @module services/webhook_filter
 * @description Pure webhook event filter and router. Matches incoming events against
 * registered filters and returns only the destinations that should receive them.
 *
 * Filters are purely declarative — they define which source + eventType pairs are
 * forwarded to which destinations. The module contains no I/O, no fetch, and no
 * external dependencies; it is safe to import into any context (Worker, test, CLI).
 *
 * ## Usage
 *
 * ```ts
 * import { buildFilter, matchFilters } from '../services/webhook_filter.js';
 *
 * const filters = [
 *   buildFilter('stripe', 'invoice.paid', 'https://hooks.example.com/billing'),
 *   buildFilter('stripe', 'customer.subscription.updated', 'https://hooks.example.com/billing'),
 *   buildFilter('dub', 'link.clicked', 'https://hooks.example.com/analytics'),
 * ];
 *
 * const matches = matchFilters(filters, 'stripe', 'invoice.paid');
 * // matches → [{ source: 'stripe', eventType: 'invoice.paid', destination: 'https://.../billing', active: true }]
 * ```
 *
 * @packageDocumentation
 */

/**
 * Represents a single webhook filter rule that maps a source + eventType pair
 * to a forwarding destination.
 *
 * @property source    - The upstream provider name (e.g. 'stripe', 'dub', 'chatwoot').
 * @property eventType - The event name within that provider (e.g. 'invoice.paid', 'link.clicked').
 * @property destination - URL or logical name where matching events should be forwarded.
 * @property active   - Whether this filter is currently enabled. Inactive filters are
 *                      skipped during matching but preserved for audit.
 */
export interface WebhookFilter {
  source: string;
  eventType: string;
  destination: string;
  active: boolean;
}

/**
 * Match an incoming source + eventType against a list of filters and return
 * every filter whose criteria match. Inactive filters are excluded from results.
 *
 * Multiple filters may match the same event if they differ by destination —
 * this is intentional (fan-out pattern). Deduplication by destination is the
 * caller's responsibility when needed.
 *
 * @param filters   - Every registered filter available for matching.
 * @param source    - The provider name of the incoming webhook.
 * @param eventType - The event type of the incoming webhook.
 * @returns A new array containing every active filter whose source and eventType
 *          match the incoming event. Returns an empty array when nothing matches.
 *
 * @example
 * ```ts
 * const filters = [
 *   buildFilter('stripe', 'invoice.paid', 'https://hook.example.com/a'),
 *   buildFilter('stripe', 'invoice.paid', 'https://hook.example.com/b'),
 * ];
 * matchFilters(filters, 'stripe', 'invoice.paid');
 * // → 2 results (fan-out)
 * matchFilters(filters, 'stripe', 'charge.refunded');
 * // → []
 * ```
 */
export function matchFilters(
  filters: readonly WebhookFilter[],
  source: string,
  eventType: string,
): WebhookFilter[] {
  return filters.filter((f) => f.active && f.source === source && f.eventType === eventType);
}

/**
 * Create a single WebhookFilter with sensible defaults.
 *
 * Convenience factory that sets `active: true` so callers only supply the
 * three business-meaningful fields. Use spread or manual assignment to
 * create inactive filters when needed.
 *
 * @param source      - Upstream provider name.
 * @param eventType   - Event type within that provider.
 * @param destination - URL or logical destination name.
 * @returns A filter object with `active` set to `true`.
 *
 * @example
 * ```ts
 * const f = buildFilter('stripe', 'invoice.paid', 'https://hook.example.com/billing');
 * // { source: 'stripe', eventType: 'invoice.paid', destination: 'https://hook.example.com/billing', active: true }
 * ```
 */
export function buildFilter(source: string, eventType: string, destination: string): WebhookFilter {
  return { active: true, destination, eventType, source };
}

/**
 * Produce a summary snapshot of all registered filters.
 *
 * Useful for health checks, dashboard display, and log padding in structured
 * observability. The `bySource` map counts every filter (active + inactive) — it
 * is the full inventory, not just the active subset.
 *
 * @param filters - Every registered filter, active or not.
 * @returns An object with the total count, the active count, and a per-source
 *          breakdown of all filters by source name.
 *
 * @example
 * ```ts
 * filterSummary(filters);
 * // { total: 5, active: 4, bySource: { stripe: 3, dub: 1, chatwoot: 1 } }
 * ```
 */
export function filterSummary(filters: readonly WebhookFilter[]): {
  total: number;
  active: number;
  bySource: Record<string, number>;
} {
  const bySource: Record<string, number> = {};

  for (const f of filters) {
    bySource[f.source] = (bySource[f.source] ?? 0) + 1;
  }

  return {
    active: filters.filter((f) => f.active).length,
    bySource,
    total: filters.length,
  };
}
