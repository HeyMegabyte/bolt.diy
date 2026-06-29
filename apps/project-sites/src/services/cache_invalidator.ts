/**
 * @module services/cache_invalidator
 *
 * @description
 * Pure KV cache-invalidation tag builder + purge-plan merger for CDN/edge.
 *
 * Models every cached object as belonging to one or more **cache scopes**:
 * a scope is a domain of concern (`site` for a specific tenant site, `org` for
 * an entire organization, `global` for platform-wide entries). Tags are
 * colon-delimited strings (`scope:id` or `scope:id:resource`) that CDN
 * providers use for targeted purges. The purge-plan helpers reduce a set
 * of tags into the smallest effective request — exact-tag purges up to
 * {@link MAX_TAGS_PER_PURGE}, prefix purges for resource-level tags, and
 * an `all` flag for worst-case global invalidation.
 *
 * Pure + total — no I/O, no clock.
 *
 * @see https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/
 */

/** The domain of concern a cache entry belongs to. */
export type CacheScope = 'site' | 'org' | 'global';

/** Describes one cache-granule scope. */
export interface CacheTag {
  readonly scope: CacheScope;
  readonly id: string;
  readonly resource?: string;
}

/**
 * Maximum tags the upstream purge API accepts in a single request.
 * CF Cache reserves 30 tags per purge call.
 */
export const MAX_TAGS_PER_PURGE = 30;

/**
 * A plan describing how to invalidate a set of cache tags.
 *
 * - `all: true` — purge the entire edge cache (emergency / global-reset only).
 * - `tags` — exact-match tags for targeted purges (≤{@link MAX_TAGS_PER_PURGE}).
 * - `prefixes` — broader scope:id prefix matches derived from resource-level
 *   tags so the caller can issue one prefix purge instead of N tag purges.
 */
export interface PurgePlan {
  readonly all: boolean;
  readonly prefixes: readonly string[];
  readonly tags: readonly string[];
}

/**
 * Build a sorted, deduplicated list of cache-invalidation tag strings from a
 * scope + id + optional resource list.
 *
 * Every call emits the **base tag** (`scope:id`, e.g. `site:vitos`) which
 * matches every cache entry under that scope unit. When `resources` is
 * provided, a per-resource tag (`scope:id:resource`) is also emitted so
 * callers can target individual pages or named entries.
 *
 * @param scope - The cache scope domain.
 * @param id    - The identifier within that scope (org UUID, site slug, etc.).
 * @param resources - Optional list of resource names (route paths, page slugs,
 *   entity names) for finer-grained invalidation.
 * @returns A deduplicated, lexicographically-sorted array of tag strings.
 *
 * @example
 * buildTags('site', 'vitos')
 * // → ['site:vitos']
 *
 * @example
 * buildTags('site', 'vitos', ['home', 'about'])
 * // → ['site:vitos', 'site:vitos:about', 'site:vitos:home']
 *
 * @example
 * buildTags('global', 'app', ['config', 'templates'])
 * // → ['global:app', 'global:app:config', 'global:app:templates']
 */
export function buildTags(scope: CacheScope, id: string, resources?: readonly string[]): string[] {
  const base = `${scope}:${id}`;
  if (!resources || resources.length === 0) return [base];

  const tags = new Set<string>([base]);
  for (const r of resources) {
    tags.add(`${base}:${r}`);
  }
  return [...tags].sort();
}

/**
 * Derive a {@link PurgePlan} from a list of tag strings.
 *
 * Strategy:
 * 1. If the `*` or `global:*` wildcard is present, return `{ all: true }` —
 *    the caller should fire a full cache reset rather than piecemeal purges.
 * 2. Otherwise, split tags into **exact** tags (the first
 *    {@link MAX_TAGS_PER_PURGE} items) and **prefixes** derived from any
 *    resource-level tags (3-segment+) so the caller can batch purge by
 *    scope:id prefix.
 *
 * @param tags - Tag strings (as produced by {@link buildTags}).
 * @returns A purge plan. Never mutated — the caller is expected to use
 *   {@link mergePurgePlans} when combining plans from multiple sources.
 *
 * @example
 * purgePlan(['site:vitos', 'site:vitos:home'])
 * // → { all: false, tags: ['site:vitos', 'site:vitos:home'], prefixes: ['site:vitos'] }
 *
 * @example
 * purgePlan(['*'])
 * // → { all: true, tags: [], prefixes: [] }
 */
export function purgePlan(tags: readonly string[]): PurgePlan {
  if (tags.length === 0) return { all: false, prefixes: [], tags: [] };

  // Wildcard → full cache reset
  if (tags.some((t) => t === '*' || t === 'global:*')) {
    return { all: true, prefixes: [], tags: [] };
  }

  // First N tags are exact-match candidates (sorted for determinism)
  const exact = tags.slice(0, MAX_TAGS_PER_PURGE).sort();

  // Derive scope:id prefixes from any resource-level (3-segment+) tags
  const prefixSet = new Set<string>();
  for (const t of tags) {
    const segments = t.split(':');
    if (segments.length >= 3) {
      prefixSet.add(segments.slice(0, 2).join(':'));
    }
  }
  const prefixes = [...prefixSet].sort();

  return { all: false, prefixes, tags: exact };
}

/**
 * Merge multiple {@link PurgePlan}s into one authoritative plan.
 *
 * Rules:
 * - If **any** constituent plan has `all: true`, the result is
 *   `{ all: true, tags: [], prefixes: [] }` — a full reset subsumes all
 *   more-targeted plans regardless of their tags.
 * - Otherwise, tags and prefixes are deduplicated and re-sorted. Exact tags
 *   are capped at {@link MAX_TAGS_PER_PURGE} (first come, first kept).
 * - Prefixes that are themselves covered by another, broader prefix are
 *   removed (e.g. `site:vitos` subsumes `site:vitos:home:header`).
 *
 * @param plans - One or more purge plans (typically one per cache scope).
 * @returns A single merged plan.
 *
 * @example
 * mergePurgePlans([
 *   { all: false, tags: ['site:vitos'], prefixes: [] },
 *   { all: false, tags: ['org:abc'], prefixes: ['org:abc'] },
 * ])
 * // → { all: false, tags: ['org:abc', 'site:vitos'], prefixes: ['org:abc'] }
 *
 * @example
 * mergePurgePlans([
 *   { all: false, tags: ['site:vitos'], prefixes: [] },
 *   { all: true, tags: [], prefixes: [] },
 * ])
 * // → { all: true, tags: [], prefixes: [] }
 */
export function mergePurgePlans(plans: readonly PurgePlan[]): PurgePlan {
  if (plans.length === 0) return { all: false, prefixes: [], tags: [] };

  // Any constituent all:true → full reset subsumes everything
  if (plans.some((p) => p.all)) {
    return { all: true, prefixes: [], tags: [] };
  }

  // Deduplicate exact tags (first MAX_TAGS_PER_PURGE wins)
  const tagSet = new Set<string>();
  for (const plan of plans) {
    for (const t of plan.tags) {
      if (tagSet.size >= MAX_TAGS_PER_PURGE) break;
      tagSet.add(t);
    }
    if (tagSet.size >= MAX_TAGS_PER_PURGE) break;
  }

  // Collect all prefixes, then prune those subsumed by a broader prefix
  const allPrefixes = new Set<string>();
  for (const plan of plans) {
    for (const p of plan.prefixes) allPrefixes.add(p);
  }

  const prefixes = [...allPrefixes]
    .filter((p) => {
      // Keep this prefix unless another, shorter prefix subsumes it
      // e.g. 'site:vitos' subsumes 'site:vitos:home:header'
      for (const other of allPrefixes) {
        if (other !== p && p.startsWith(`${other}:`)) return false;
      }
      return true;
    })
    .sort();

  return {
    all: false,
    prefixes,
    tags: [...tagSet].sort(),
  };
}
