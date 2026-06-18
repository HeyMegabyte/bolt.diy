import { packByBudget } from '../services/context_pack';

/**
 * AI context-quality axis (item #4, the PURE pack half) — given pre-scored
 * candidates (the BGE reranker is the separate I/O half), pack the
 * highest-scored ones into the context window under a char budget so the window
 * is DENSE with signal, never truncated mid-fact. Pure + total; never throws.
 */

describe('packByBudget', () => {
  const items = [
    { text: 'aaa', score: 0.9 }, // 3 chars
    { text: 'bbbbb', score: 0.5 }, // 5 chars
    { text: 'cc', score: 0.7 }, // 2 chars
  ];

  it('packs highest-score-first and reports usage', () => {
    const r = packByBudget(items, { maxChars: 100, separatorChars: 0 });
    expect(r.packed).toEqual(['aaa', 'cc', 'bbbbb']); // score desc: .9, .7, .5
    expect(r.includedCount).toBe(3);
    expect(r.droppedCount).toBe(0);
    expect(r.usedChars).toBe(10);
  });

  it('drops items that exceed the remaining budget but keeps trying smaller ones', () => {
    // budget 6, sep 0: take aaa(3, rem3) → cc(2, rem1) → bbbbb(5) skip → done
    const r = packByBudget(items, { maxChars: 6, separatorChars: 0 });
    expect(r.packed).toEqual(['aaa', 'cc']);
    expect(r.includedCount).toBe(2);
    expect(r.droppedCount).toBe(1);
    expect(r.usedChars).toBe(5);
  });

  it('accounts for separator chars between packed items', () => {
    // sep 2: aaa(3) → +sep2+cc(2)=7 → +sep2+bbbbb(5)=14
    const r = packByBudget(items, { maxChars: 7, separatorChars: 2 });
    expect(r.packed).toEqual(['aaa', 'cc']);
    expect(r.usedChars).toBe(7);
  });

  it('packs nothing when the budget is zero or negative', () => {
    expect(packByBudget(items, { maxChars: 0 }).packed).toEqual([]);
    expect(packByBudget(items, { maxChars: -5 }).droppedCount).toBe(3);
  });

  it('preserves input order on score ties (stable)', () => {
    const tied = [
      { text: 'first', score: 0.5 },
      { text: 'second', score: 0.5 },
    ];
    expect(packByBudget(tied, { maxChars: 100, separatorChars: 0 }).packed).toEqual([
      'first',
      'second',
    ]);
  });

  it('returns empty for empty input and never throws on junk', () => {
    expect(packByBudget([], { maxChars: 10 }).packed).toEqual([]);
    expect(packByBudget(undefined as unknown as never, { maxChars: 10 }).includedCount).toBe(0);
  });

  it('skips blank-text items without counting them as dropped signal', () => {
    const r = packByBudget(
      [
        { text: '   ', score: 1 },
        { text: 'real', score: 0.5 },
      ],
      {
        maxChars: 100,
        separatorChars: 0,
      },
    );
    expect(r.packed).toEqual(['real']);
  });
});
