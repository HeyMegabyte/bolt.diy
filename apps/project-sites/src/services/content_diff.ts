/**
 * @module services/content_diff
 * @description Pure word-level diff/merge for content blobs. A bag-of-words
 * approach that determines which words were added, removed, or stayed in common
 * between two versions of text. Designed for content-change detection, analytics
 * summaries, and approximate text reconstruction.
 *
 * This is NOT a line-level or LCS diff — it operates on word tokens split at
 * whitespace boundaries, using multiset comparison. Positional order within each
 * result list preserves the source order of the respective text.
 *
 * @packageDocumentation
 */

/** The word-level difference between two texts. */
export interface ContentDiff {
  /** Words present in `newText` but not (or appearing more in) `oldText`, in new-text order. */
  added: string[];
  /** Words present in `oldText` but not (or appearing more in) `newText`, in old-text order. */
  removed: string[];
  /** Words present in both texts at the shared count, in old-text order (first N occurrences). */
  unchanged: string[];
}

/** Numeric summary of a content diff. */
export interface DiffStats {
  /** Count of added words. */
  additions: number;
  /** Count of removed words. */
  deletions: number;
  /** Count of unchanged words (shared by both texts). */
  unchanged: number;
  /** Fraction of total words that changed — 0 (identical) to 1 (completely different). */
  changeRate: number;
}

/**
 * Tokenize a string into words (non-whitespace runs). Preserves order.
 *
 * @param text - The string to split.
 * @returns Array of word tokens. Empty array for empty/null/undefined input.
 *
 * @example
 * tokenize('hello world');
 * // → ['hello', 'world']
 */
function tokenize(text: string | null | undefined): string[] {
  return (text ?? '').trim().split(/\s+/).filter(Boolean);
}

/**
 * Build a word → frequency map from an array of tokens.
 *
 * @param words - Token array.
 * @returns Frequency map.
 */
function frequencies(words: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const w of words) {
    map.set(w, (map.get(w) ?? 0) + 1);
  }
  return map;
}

/**
 * Compare two texts and produce a word-level diff.
 *
 * @remarks
 * Pure + deterministic. Tokenizes both texts on whitespace, then determines
 * each unique word's role via multiset comparison:
 *
 * - **Unchanged** — `min(oldCount, newCount)` copies, in old-text order.
 * - **Removed** — `oldCount − newCount` copies, in old-text order.
 * - **Added** — `newCount − oldCount` copies, in new-text order.
 *
 * Case-sensitive. Empty/null/undefined inputs are treated as empty strings
 * and always yield an empty diff.
 *
 * @param oldText - The earlier version of the text.
 * @param newText - The later version of the text.
 * @returns A {@link ContentDiff} result.
 *
 * @example
 * const d = diffText('a b c c', 'b c d');
 * // → { added: ['d'], removed: ['a', 'c'], unchanged: ['b', 'c'] }
 */
export function diffText(
  oldText: string | null | undefined,
  newText: string | null | undefined,
): ContentDiff {
  const oldWords = tokenize(oldText);
  const newWords = tokenize(newText);

  const oldFreq = frequencies(oldWords);
  const newFreq = frequencies(newWords);

  const allWords = new Set([...oldWords, ...newWords]);

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  for (const w of allWords) {
    const oc = oldFreq.get(w) ?? 0;
    const nc = newFreq.get(w) ?? 0;

    // Unchanged — min(oc, nc) copies in old-text order.
    const unchangedCount = Math.min(oc, nc);
    let uc = 0;
    for (const ow of oldWords) {
      if (ow === w && uc < unchangedCount) {
        unchanged.push(ow);
        uc++;
      }
    }

    // Removed — extra copies in old-text.
    const removedCount = oc - nc;
    if (removedCount > 0) {
      let rc = 0;
      for (const ow of oldWords) {
        if (ow === w && rc < removedCount) {
          removed.push(ow);
          rc++;
        }
      }
    }

    // Added — extra copies in new-text.
    const addedCount = nc - oc;
    if (addedCount > 0) {
      let ac = 0;
      for (const nw of newWords) {
        if (nw === w && ac < addedCount) {
          added.push(nw);
          ac++;
        }
      }
    }
  }

  return { added, removed, unchanged };
}

/**
 * Summarise a content diff into numerical statistics.
 *
 * @remarks
 * Pure + deterministic. Never throws. `changeRate` is 0 when total words is 0.
 *
 * @param diff - The {@link ContentDiff} to summarise.
 * @returns {@link DiffStats} with counts and the change rate (0–1).
 *
 * @example
 * const d = diffText('hello world', 'hello there');
 * diffStats(d);
 * // → { additions: 1, deletions: 1, unchanged: 1, changeRate: 0.666... }
 */
export function diffStats(diff: ContentDiff): DiffStats {
  const additions = diff.added.length;
  const deletions = diff.removed.length;
  const unchanged = diff.unchanged.length;
  const total = additions + deletions + unchanged;
  return {
    additions,
    changeRate: total === 0 ? 0 : (additions + deletions) / total,
    deletions,
    unchanged,
  };
}

/**
 * Approximate the new text by removing the `removed` words from the input
 * text and appending the `added` words.
 *
 * @remarks
 * Pure + deterministic. Because the diff is bag-of-words (not positional),
 * this reconstruction may reorder words compared to the original `newText`.
 * The WORD MULTISET matches exactly — every word that belongs is present, and
 * words that should be gone are gone. Use for storage/collation, not for
 * byte-for-byte exact round-trips.
 *
 * Operates on the first matching occurrence of each removed word, consuming
 * one entry per word. If the text has more copies of a removed word than
 * the diff lists, the extra copies survive.
 *
 * @param text - The original (old) text to apply the diff against.
 * @param diff - The diff produced by {@link diffText}.
 * @returns The reconstructed text with removed words stripped and added
 *   words appended.
 *
 * @example
 * const d = diffText('hello world cup', 'hello there world');
 * applyDiff('hello world cup', d);
 * // → 'hello world there'  (removed 'cup', added 'there')
 */
export function applyDiff(text: string, diff: ContentDiff): string {
  const words = tokenize(text);
  const leftover = [...diff.removed];

  const kept = words.filter((w) => {
    const idx = leftover.indexOf(w);
    if (idx !== -1) {
      leftover.splice(idx, 1);
      return false;
    }
    return true;
  });

  return [...kept, ...diff.added].join(' ');
}
