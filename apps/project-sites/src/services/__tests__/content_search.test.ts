import {
  tokenize,
  indexContent,
  searchContent,
  contentRelevance,
  type SearchDoc,
} from '../content_search';

// ── Fixtures ────────────────────────────────────────────────────────

const DOCS: SearchDoc[] = [
  {
    id: 'pizza-place',
    title: 'Pizza Place',
    content:
      'Best pizza in Newark with fresh mozzarella and homemade sauce. Family-owned since 1985.',
  },
  {
    id: 'pasta-italian',
    title: 'Pasta Italiana',
    content: 'Authentic Italian pasta and classic sauces. Dine-in or takeout in Newark.',
  },
  {
    id: 'taco-shop',
    title: 'Taco Shop',
    content: 'Tacos with fresh salsa, guacamole, and grilled meats. Catering available.',
  },
  {
    id: 'sushi-bar',
    title: 'Sushi Bar',
    content: 'Fresh sushi rolls and sashimi prepared by master chefs. Daily specials.',
  },
];

// ── tokenize ────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('splits text into lowercase tokens', () => {
    expect(tokenize('Hello World! HELLO.')).toEqual(['hello', 'world']);
  });

  it('filters stop words', () => {
    expect(tokenize('the cat in the hat')).toEqual(['cat', 'hat']);
  });

  it('filters tokens shorter than 2 characters', () => {
    expect(tokenize('a is x o')).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('deduplicates repeated tokens', () => {
    expect(tokenize('hello hello world')).toEqual(['hello', 'world']);
  });

  it('strips non-word characters from token edges', () => {
    expect(tokenize('"pizza!" and (sauce)')).toEqual(['pizza', 'sauce']);
  });

  it('handles only punctuation', () => {
    expect(tokenize('!!! ...')).toEqual([]);
  });
});

// ── indexContent ────────────────────────────────────────────────────

describe('indexContent', () => {
  it('indexes all docs and builds term map', () => {
    const idx = indexContent(DOCS);
    expect(idx.docs.size).toBe(4);
    expect(idx.totalDocs).toBe(4);
    // "pizza" should appear in doc "pizza-place" only
    expect(idx.terms.get('pizza')).toEqual(new Set(['pizza-place']));
  });

  it('maps terms shared across docs', () => {
    const idx = indexContent(DOCS);
    // "newark" appears in pizza-place and pasta-italian
    expect(idx.terms.get('newark')).toEqual(new Set(['pizza-place', 'pasta-italian']));
  });

  it('returns empty index when given no docs', () => {
    const idx = indexContent([]);
    expect(idx.docs.size).toBe(0);
    expect(idx.totalDocs).toBe(0);
    expect(idx.terms.size).toBe(0);
  });

  it('indexes a single doc', () => {
    const idx = indexContent([DOCS[0]]);
    expect(idx.docs.size).toBe(1);
    expect(idx.totalDocs).toBe(1);
  });
});

// ── searchContent ───────────────────────────────────────────────────

describe('searchContent', () => {
  it('returns matching docs sorted by relevance', () => {
    const idx = indexContent(DOCS);
    const results = searchContent(idx, 'newark pizza');
    expect(results.length).toBeGreaterThanOrEqual(1);
    // pizza-place should be the top result
    expect(results[0].docId).toBe('pizza-place');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('returns empty for unmatched query', () => {
    const idx = indexContent(DOCS);
    expect(searchContent(idx, 'quantum physics')).toEqual([]);
  });

  it('returns empty for empty query', () => {
    const idx = indexContent(DOCS);
    expect(searchContent(idx, '')).toEqual([]);
  });

  it('returns empty when index has no docs', () => {
    const idx = indexContent([]);
    expect(searchContent(idx, 'pizza')).toEqual([]);
  });

  it('finds docs by stop words only — returns empty', () => {
    const idx = indexContent(DOCS);
    expect(searchContent(idx, 'the a')).toEqual([]);
  });

  it('scores higher for title matches', () => {
    const idx = indexContent(DOCS);
    const tacoResults = searchContent(idx, 'taco');
    expect(tacoResults[0].docId).toBe('taco-shop');
    const sushiResults = searchContent(idx, 'sushi');
    expect(sushiResults[0].docId).toBe('sushi-bar');
  });

  it('matches a single term across multiple docs', () => {
    const idx = indexContent(DOCS);
    // "newark" appears in pizza-place and pasta-italian
    const results = searchContent(idx, 'newark');
    expect(results.length).toBe(2);
    const ids = results.map((r) => r.docId).sort();
    expect(ids).toEqual(['pasta-italian', 'pizza-place']);
  });

  it('sorts results descending by score', () => {
    const idx = indexContent(DOCS);
    const results = searchContent(idx, 'newark fresh');
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });
});

// ── contentRelevance ────────────────────────────────────────────────

describe('contentRelevance', () => {
  it('returns 1 when all query tokens are found', () => {
    const score = contentRelevance(DOCS[0], 'pizza newark');
    expect(score).toBe(1);
  });

  it('returns 0 when no query tokens are found', () => {
    const score = contentRelevance(DOCS[0], 'quantum physics');
    expect(score).toBe(0);
  });

  it('returns 0 for empty query', () => {
    const score = contentRelevance(DOCS[0], '');
    expect(score).toBe(0);
  });

  it('returns partial score for partial match', () => {
    // "pizza" matches, "chicago" does not
    const score = contentRelevance(DOCS[0], 'pizza chicago');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('awards title-match bonus', () => {
    const titleScore = contentRelevance(DOCS[0], 'pizza');
    // "Pizza" is in the title, so the title bonus fires
    expect(titleScore).toBeGreaterThan(0);
  });

  it('scores the same doc consistently', () => {
    const a = contentRelevance(DOCS[1], 'pasta italian');
    const b = contentRelevance(DOCS[1], 'pasta italian');
    expect(a).toBe(b);
  });
});
