/**
 * @module services/cmd_k_data
 * @description Pure zero-I/O Cmd+K command palette data model: typed items,
 * cross-app deep-link builder, search/filter, and match scoring. No side
 * effects, no throws, defensive against empty input.
 *
 * @example
 * ```ts
 * import { buildCmdK, filterCmdK, matchScore } from '../services/cmd_k_data.js';
 *
 * const items = [
 *   { id: 'sites:list', label: 'Sites', description: 'Manage websites', url: '/admin/sites', category: 'navigation', keywords: ['websites', 'domains'] },
 *   { id: 'new:site', label: 'New Site', description: 'Create a site', url: '/admin/sites/new', category: 'action', keywords: ['create', 'add'] },
 * ];
 *
 * const groups = buildCmdK(items);
 * const results = filterCmdK(items, 'site');
 * const score = matchScore(items[0], 'sites');
 * ```
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CmdKItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly url: string;
  readonly category: 'navigation' | 'action' | 'app' | 'search';
  readonly keywords: readonly string[];
  readonly external?: boolean;
}

export interface CmdKGroup {
  readonly category: CmdKItem['category'];
  readonly items: readonly CmdKItem[];
}

/* ------------------------------------------------------------------ */
/*  Category ordering                                                  */
/* ------------------------------------------------------------------ */

const CATEGORY_ORDER: Record<CmdKItem['category'], number> = {
  action: 1,
  app: 2,
  navigation: 0,
  search: 3,
} as const;

/* ------------------------------------------------------------------ */
/*  buildCmdK — group by category, sort within groups                  */
/* ------------------------------------------------------------------ */

/**
 * Build a command palette dataset from item definitions.
 *
 * Groups items by category in navigation → action → app → search order.
 * Within each group, sorts alphabetically by label (case-insensitive).
 * Silently skips items missing an id or label.
 *
 * @param items - Command items to organize. Empty array returns an empty array.
 * @returns Ordered array of groups, one per category that had at least one valid item.
 * @example
 * ```ts
 * const groups = buildCmdK([...items]);
 * // → [
 * //   { category: 'navigation', items: [nav items sorted] },
 * //   { category: 'action',    items: [action items sorted] },
 * // ]
 * ```
 */
export function buildCmdK(items: readonly CmdKItem[]): CmdKGroup[] {
  const valid = items.filter((item) => item.id && item.label);

  if (valid.length === 0) {
    return [];
  }

  const byCategory = new Map<CmdKItem['category'], CmdKItem[]>();

  for (const item of valid) {
    const existing = byCategory.get(item.category);
    if (existing) {
      existing.push(item);
    } else {
      byCategory.set(item.category, [item]);
    }
  }

  const sortedCategories = [...byCategory.entries()].sort(
    ([a], [b]) => (CATEGORY_ORDER[a] ?? 99) - (CATEGORY_ORDER[b] ?? 99),
  );

  return sortedCategories.map(([category, items]) => ({
    category,
    items: items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })),
  }));
}

/* ------------------------------------------------------------------ */
/*  filterCmdK — search across labels, descriptions, and keywords      */
/* ------------------------------------------------------------------ */

/**
 * Filter items by a search query (case-insensitive).
 *
 * Returns items where the query matches the label, description, or any
 * keyword. Empty query returns an empty result. Results sorted by match
 * quality descending.
 *
 * @param items - Items to search. Empty array returns an empty array.
 * @param query - Search string. Trimmed internally. Empty or whitespace-only returns empty array.
 * @returns Matched items sorted by matchScore descending.
 * @example
 * ```ts
 * const results = filterCmdK(allItems, 'sites');
 * // → [label-exact-prefix matches first, then label-contains, then keyword matches]
 * ```
 */
export function filterCmdK(items: readonly CmdKItem[], query: string): readonly CmdKItem[] {
  const trimmed = query.trim();

  if (!trimmed || items.length === 0) {
    return [];
  }

  const matched = items.filter((item) => matchScore(item, trimmed) > 0);

  return matched.sort((a, b) => matchScore(b, trimmed) - matchScore(a, trimmed));
}

/* ------------------------------------------------------------------ */
/*  matchScore — rank how well an item matches a query                 */
/* ------------------------------------------------------------------ */

/**
 * Score how well an item matches a query. Higher is better.
 *
 * Scoring tiers (descending priority):
 * 1. **100** — Label starts with the query (case-insensitive).
 * 2. **60** — Label contains the query as a whole word (case-insensitive, boundary match).
 * 3. **50** — Label contains the query anywhere (case-insensitive).
 * 4. **25** — Any keyword contains the query as a substring (case-insensitive).
 * 5. **10** — Description contains the query as a substring (case-insensitive).
 * 6. **0** — No match.
 *
 * Only the highest-scoring tier applies. Adjacent tiers are not additive.
 *
 * @param item - The command item to evaluate.
 * @param query - Search string (should be pre-trimmed by caller).
 * @returns A score from 0–100. 0 means no match.
 * @example
 * ```ts
 * matchScore({ label: 'Sites', keywords: ['websites'], ... }, 'site')  // → 100
 * matchScore({ label: 'New Site', ... },     'site')                   // → 60
 * matchScore({ label: 'Billing', keywords: ['subscription'], ... }, 'sub') // → 25
 * ```
 */
export function matchScore(item: CmdKItem, query: string): number {
  if (!query) return 0;

  const lowerLabel = item.label.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Tier 1: Label starts with query
  if (lowerLabel.startsWith(lowerQuery)) {
    return 100;
  }

  // Tier 2: Label contains query at a word boundary
  if (
    lowerLabel.length > lowerQuery.length &&
    lowerLabel.includes(lowerQuery) &&
    (lowerLabel[0] === lowerQuery[0] ||
      /\s/.test(lowerLabel[lowerLabel.indexOf(lowerQuery) - 1] ?? ''))
  ) {
    return 60;
  }

  // Tier 3: Label contains query anywhere
  if (lowerLabel.includes(lowerQuery)) {
    return 50;
  }

  // Tier 4: Any keyword contains query
  if (item.keywords.some((kw) => kw.toLowerCase().includes(lowerQuery))) {
    return 25;
  }

  // Tier 5: Description contains query
  if (item.description.toLowerCase().includes(lowerQuery)) {
    return 10;
  }

  return 0;
}

export {};
