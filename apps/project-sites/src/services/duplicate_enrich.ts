/**
 * @module services/duplicate_enrich
 * @description Pure text-processing utilities for detecting duplicate issues
 * by title similarity and enriching issue body content with metadata.
 * Zero external dependencies, never throws.
 */

// ── Types ────────────────────────────────────────────────────────

export interface IssueInput {
  title: string;
  body: string;
  id?: string;
}

export interface DupCheck {
  isDuplicate: boolean;
  similarTo: string | null;
  similarity: number; // 0–100
}

export interface BodyEnrichment {
  wordCount: number;
  hasCode: boolean;
  hasUrl: boolean;
}

// ── Internals ────────────────────────────────────────────────────

/**
 * Split a string into word trigrams (groups of 3 consecutive words).
 * Words are lowercased and punctuation-stripped. Returns an empty array when
 * fewer than 3 words are available.
 *
 * @example
 * toWordTrigrams('The quick brown fox jumps') // => ['the quick brown', 'quick brown fox', 'brown fox jumps']
 */
function toWordTrigrams(text: string): string[] {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^\w\s']/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 3) return [];
  const trigrams: string[] = [];
  for (let i = 0; i <= words.length - 3; i++) {
    trigrams.push(words.slice(i, i + 3).join(' '));
  }
  return trigrams;
}

/**
 * Jaccard similarity coefficient between two string arrays.
 * Returns a value in [0, 1] where 0 = completely disjoint, 1 = identical.
 *
 * @example
 * jaccard(['a', 'b'], ['b', 'c']) // => 0.333...
 */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const intersection = a.filter((x) => setB.has(x));
  const unionSize = new Set([...a, ...b]).size;
  return intersection.length / unionSize;
}

// ── Exports ──────────────────────────────────────────────────────

/**
 * Detect whether an incoming issue is a duplicate of any existing issue
 * by comparing word-trigram Jaccard similarity on the title.
 *
 * Returns the closest match when similarity >= 0.6 (threshold). Otherwise
 * reports no duplicate found.
 *
 * @param issue - The incoming issue to check
 * @param existing - Array of existing issues to compare against
 * @returns DupCheck with match details and 0–100 similarity score
 *
 * @example
 * const check = detectDuplicate(
 *   { title: 'Login fails on Safari', body: '…' },
 *   [{ title: 'Safari login broken', body: '…', id: 'ISSUE-1' }],
 * );
 * // => { isDuplicate: true, similarTo: 'ISSUE-1', similarity: 66 }
 *
 * @example
 * const check = detectDuplicate(
 *   { title: 'Add dark mode', body: '…' },
 *   [{ title: 'Login fails on Safari', body: '…', id: 'ISSUE-1' }],
 * );
 * // => { isDuplicate: false, similarTo: null, similarity: 0 }
 *
 * @remarks Pure function — no I/O, no side-effects, no throws.
 */
export function detectDuplicate(issue: IssueInput, existing: readonly IssueInput[]): DupCheck {
  if (existing.length === 0) {
    return { isDuplicate: false, similarity: 0, similarTo: null };
  }

  const incomingTrigrams = toWordTrigrams(issue.title);
  if (incomingTrigrams.length === 0) {
    return { isDuplicate: false, similarity: 0, similarTo: null };
  }

  let bestMatch: { id: string | null; score: number } = { id: null, score: 0 };

  for (const existingIssue of existing) {
    const existingTrigrams = toWordTrigrams(existingIssue.title);
    if (existingTrigrams.length === 0) continue;

    const score = jaccard(incomingTrigrams, existingTrigrams);
    if (
      score > 0 &&
      (score > bestMatch.score || (score === bestMatch.score && existingIssue.id && !bestMatch.id))
    ) {
      bestMatch = { id: existingIssue.id ?? null, score };
    }
  }

  const percentage = Math.round(bestMatch.score * 100);
  const isDuplicate = bestMatch.score >= 0.6;

  return {
    isDuplicate,
    similarity: percentage,
    similarTo: bestMatch.id,
  };
}

/**
 * Enrich a raw issue body with computed metadata.
 *
 * Produces a word count, a boolean indicating whether the body contains
 * code (fenced or inline backtick blocks), and a boolean for URL presence.
 *
 * @param body - The raw issue body text
 * @returns BodyEnrichment with wordCount, hasCode, and hasUrl
 *
 * @example
 * enrichBody('Hello world') // => { wordCount: 2, hasCode: false, hasUrl: false }
 *
 * @example
 * enrichBody('Fix the bug in `handleClick()`') // => { wordCount: 6, hasCode: true, hasUrl: false }
 *
 * @example
 * enrichBody('See https://example.com for details') // => { wordCount: 5, hasCode: false, hasUrl: true }
 *
 * @remarks Pure function — no I/O, no side-effects, no throws.
 */
export function enrichBody(body: string): BodyEnrichment {
  const trimmed = (body ?? '').trim();

  // Word count: split on any contiguous whitespace
  const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;

  // Code detection: fenced code blocks (```) or inline backtick sequences
  const hasCode = /```[\s\S]*?```|`[^`]+`/.test(trimmed);

  // URL detection: common protocol-relative or full URLs
  const hasUrl = /https?:\/\/[^\s]+|www\.[^\s]+/i.test(trimmed);

  return { hasCode, hasUrl, wordCount };
}
