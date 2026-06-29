/**
 * @module services/content_search
 * @description Lightweight in-memory content indexing and search for docs.
 *
 * Builds a simple inverted index over document content, supports multi-term
 * queries scored by TF-IDF-like relevance, and exposes a per-doc relevance
 * helper. Pure — zero I/O, no dependencies beyond Node builtins.
 */

// ── Types ───────────────────────────────────────────────────────────

/** A document that can be indexed and searched. */
export interface SearchDoc {
  /** Unique identifier (slug, uuid, or DB key). */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Full-text body to index. */
  content: string;
}

/** One search result — a doc id paired with its relevance score. */
export interface SearchResult {
  /** The matching doc's {@link SearchDoc.id}. */
  docId: string;
  /** Relevance score (higher = better match). */
  score: number;
}

/**
 * Inverted index produced by {@link indexContent}.
 *
 * @internal
 */
export interface DocIndex {
  /** Every indexed doc keyed by id. */
  docs: Map<string, SearchDoc>;
  /** Lowercase term → set of doc ids containing that term. */
  terms: Map<string, Set<string>>;
  /** Total document count (used for IDF). */
  totalDocs: number;
}

// ── Constants ───────────────────────────────────────────────────────

/** Characters stripped from the ends of each token. */
const TRIM_RE = /^[^\w-]+|[^\w-]+$/g;

/** Minimum token length (shorter tokens are ignored). */
const MIN_TOKEN_LENGTH = 2;

/** Words that are not indexed (stop words). */
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'as',
  'is',
  'was',
  'are',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'need',
  'dare',
  'ought',
  'used',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'she',
  'him',
  'her',
  'his',
  'they',
  'them',
  'their',
  'not',
  'no',
  'nor',
  'so',
  'if',
  'then',
  'than',
  'too',
  'very',
  'just',
  'about',
  'up',
  'out',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'some',
  'any',
  'such',
  'only',
  'own',
  'same',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'what',
  'which',
  'who',
  'whom',
]);

// ── Tokenizer ───────────────────────────────────────────────────────

/**
 * Split text into normalized lowercase tokens, filtering stop words and
 * very short tokens.
 *
 * @param text - raw input string
 * @returns deduplicated tokens in occurrence order
 *
 * @example
 * tokenize('Hello World! HELLO.')
 * // → ['hello', 'world']
 */
export function tokenize(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/\s+/)) {
    const t = raw.replace(TRIM_RE, '');
    if (t.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(t) && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// ── Indexing ────────────────────────────────────────────────────────

/**
 * Build an inverted index from an array of documents. Each doc is tokenized
 * and every unique term maps to the set of doc ids containing it.
 *
 * PURE — no side-effects, no I/O.
 *
 * @param docs - documents to index
 * @returns a {@link DocIndex} ready for searching
 *
 * @example
 * const docs = [
 *   { id: '1', title: 'Pizza', content: 'Best pizza in Newark with fresh mozzarella.' },
 *   { id: '2', title: 'Pasta', content: 'Homemade pasta and classic Italian sauce.' },
 * ];
 * const idx = indexContent(docs);
 * idx.terms.get('pizza') // → Set { '1' }
 */
export function indexContent(docs: SearchDoc[]): DocIndex {
  const docsMap = new Map<string, SearchDoc>();
  const terms = new Map<string, Set<string>>();

  for (const doc of docs) {
    docsMap.set(doc.id, doc);
    const tokens = tokenize(`${doc.title} ${doc.title} ${doc.content}`); // title weighted 2×
    for (const t of tokens) {
      const ids = terms.get(t);
      if (ids) {
        ids.add(doc.id);
      } else {
        terms.set(t, new Set([doc.id]));
      }
    }
  }

  return { docs: docsMap, terms, totalDocs: docs.length };
}

// ── Search ──────────────────────────────────────────────────────────

/**
 * Search an index for docs matching the query, scored by TF-IDF-like
 * relevance (term frequency within doc × inverse doc frequency). Results
 * are sorted best-first.
 *
 * PURE — does not mutate the index.
 *
 * @param index - the {@link DocIndex} to search
 * @param query - free-text search query
 * @returns {@link SearchResult} array, sorted by descending score (empty
 * when there are no matches)
 *
 * @example
 * const idx = indexContent([{ id: '1', title: 'Pizza', content: 'Best pizza in Newark.' }]);
 * searchContent(idx, 'newark pizza')
 * // → [{ docId: '1', score: 1.43 }]
 */
export function searchContent(index: DocIndex, query: string): SearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || index.totalDocs === 0) return [];

  const idfCache = new Map<string, number>();
  const getIDF = (term: string): number => {
    const cached = idfCache.get(term);
    if (cached !== undefined) return cached;
    const df = (index.terms.get(term)?.size ?? 0) + 1; // +1 smoothing
    const idf = Math.log10(index.totalDocs / df) + 1;
    idfCache.set(term, idf);
    return idf;
  };

  // Score each unique query term across matched docs.
  const scores = new Map<string, number>();
  for (const qt of queryTokens) {
    const matched = index.terms.get(qt);
    if (!matched) continue;
    const idf = getIDF(qt);
    for (const docId of matched) {
      const doc = index.docs.get(docId);
      if (!doc) continue;
      // Count term occurrences in this doc.
      const full = `${doc.title} ${doc.title} ${doc.content}`.toLowerCase();
      let count = 0;
      let pos = 0;
      while (pos < full.length) {
        const hit = full.indexOf(qt, pos);
        if (hit === -1) break;
        count++;
        pos = hit + qt.length;
      }
      // TF = log(1 + count); score = TF × IDF
      const tf = Math.log10(1 + count);
      const existing = scores.get(docId) ?? 0;
      scores.set(docId, existing + tf * idf);
    }
  }

  // Assemble and sort.
  const results: SearchResult[] = [];
  for (const [docId, score] of scores) {
    if (score > 0) results.push({ docId, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ── Relevance ───────────────────────────────────────────────────────

/**
 * Compute a coarse relevance score (0–1) for a single doc against a query
 * without building an index. Useful for one-off checks or filtering.
 *
 * PURE — no I/O.
 *
 * The score is the fraction of unique query tokens also present in the doc's
 * title or content. Title matches contribute more weight (a title hit counts
 * twice).
 *
 * @param doc - the document to score
 * @param query - free-text query
 * @returns a number between 0 (no match) and 1 (all query tokens found)
 *
 * @example
 * contentRelevance(
 *   { id: '1', title: 'Pizza Place', content: 'Best pizza in Newark.' },
 *   'newark pizza',
 * )
 * // → 1
 *
 * contentRelevance(
 *   { id: '1', title: 'Pizza Place', content: 'Best pizza in Newark.' },
 *   'italian pasta',
 * )
 * // → 0
 */
export function contentRelevance(doc: SearchDoc, query: string): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;

  const titleLower = doc.title.toLowerCase();
  const contentLower = doc.content.toLowerCase();

  let weightSum = 0;
  let matches = 0;

  for (const t of qTokens) {
    weightSum += 1;
    const inTitle = titleLower.includes(t) ? 1 : 0;
    const inContent = contentLower.includes(t) ? 1 : 0;
    // Title match counts as 2, content match as 1.
    // Still award 1 when content matches even if title doesn't.
    if (inTitle > 0 || inContent > 0) {
      matches += Math.max(inTitle * 2, inContent * 1);
      weightSum += inTitle; // add extra weight for title bonus
    }
  }

  return weightSum > 0 ? matches / weightSum : 0;
}
