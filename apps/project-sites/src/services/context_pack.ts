/**
 * @module services/context_pack
 *
 * @description
 * AI context-quality axis (item #4, the PURE pack half, per `_ULTIMATE_LOOP.prompt.md`).
 * Given pre-scored candidate snippets (the BGE reranker that produces the scores
 * is the separate I/O half), greedily pack the highest-scored ones into the
 * context window under a character budget — so the window is DENSE with the
 * strongest signal and never truncated mid-fact. Pairs with `labeled_context`
 * (assemble) + `context_readiness` (gate).
 *
 * @remarks
 * - PURE + TOTAL: no I/O, never throws. Junk/empty input → an empty pack.
 * - Highest score first; on a tie, input order is preserved (stable).
 * - An item that doesn't fit the REMAINING budget is skipped, but packing
 *   CONTINUES — a smaller lower-ranked item can still fit (maximizes fill).
 * - `separatorChars` models the glue (e.g. `\n\n`) counted BETWEEN packed items.
 *
 * @example
 * ```ts
 * const { packed } = packByBudget(rankedFacts, { maxChars: 8000, separatorChars: 2 });
 * const block = packed.join('\n\n');
 * ```
 */

/** A scored candidate snippet to consider for packing. */
export interface ScoredItem {
  /** The snippet text. */
  text: string;
  /** Relevance score (higher = packed first). */
  score: number;
}

export interface PackByBudgetOptions {
  /** Maximum total characters the packed block may occupy. */
  maxChars: number;
  /** Characters counted between consecutive packed items (e.g. 2 for `\n\n`). Default 2. */
  separatorChars?: number;
}

export interface PackByBudgetResult {
  /** The packed snippet texts, in packed (score-desc) order. */
  packed: string[];
  /** How many items were packed. */
  includedCount: number;
  /** How many non-blank items were considered but did not fit. */
  droppedCount: number;
  /** Total characters used (text + separators). */
  usedChars: number;
}

/**
 * Greedily pack the highest-scored snippets under a character budget.
 *
 * @param items - Scored candidates (any order; sorted internally).
 * @param opts  - Budget + separator sizing.
 * @returns The packed set + usage accounting.
 */
export function packByBudget(items: ScoredItem[], opts: PackByBudgetOptions): PackByBudgetResult {
  const empty: PackByBudgetResult = {
    droppedCount: 0,
    includedCount: 0,
    packed: [],
    usedChars: 0,
  };
  if (!Array.isArray(items) || items.length === 0) return empty;

  const maxChars = typeof opts?.maxChars === 'number' ? opts.maxChars : 0;
  const sep = typeof opts?.separatorChars === 'number' ? opts.separatorChars : 2;

  // Non-blank candidates only; stable sort by score desc (preserve order on tie).
  const candidates = items
    .map((it, i) => ({ i, it }))
    .filter(({ it }) => typeof it.text === 'string' && it.text.trim().length > 0)
    .sort((a, b) => b.it.score - a.it.score || a.i - b.i);

  const packed: string[] = [];
  let usedChars = 0;
  let droppedCount = 0;

  for (const { it } of candidates) {
    const addition = (packed.length === 0 ? 0 : sep) + it.text.length;
    if (maxChars > 0 && usedChars + addition <= maxChars) {
      packed.push(it.text);
      usedChars += addition;
    } else {
      droppedCount++;
    }
  }

  return { droppedCount, includedCount: packed.length, packed, usedChars };
}
