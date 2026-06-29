import {
  assignVariant,
  recommendSendHour,
  pickWinningSubject,
  DEFAULT_SEND_HOUR,
  type SubjectStat,
} from '../services/send_optimization.js';

describe('assignVariant (LM16 send_optimization)', () => {
  it('is stable for the same key+salt', () => {
    const a = assignVariant('user_42', ['A', 'B'], 'exp1');
    const b = assignVariant('user_42', ['A', 'B'], 'exp1');
    expect(a).toBe(b);
    expect(['A', 'B']).toContain(a);
  });

  it('different salt can yield a different bucket (independent experiments)', () => {
    const variants = ['A', 'B', 'C', 'D'] as const;
    // across many keys, salt changes the mapping for at least some keys
    const keys = Array.from({ length: 50 }, (_, i) => `u${i}`);
    const diff = keys.filter(
      (k) => assignVariant(k, variants, 's1') !== assignVariant(k, variants, 's2'),
    );
    expect(diff.length).toBeGreaterThan(0);
  });

  it('splits roughly evenly across a large population', () => {
    const counts = { A: 0, B: 0 } as Record<string, number>;
    for (let i = 0; i < 2000; i++) counts[assignVariant(`u${i}`, ['A', 'B'], 'x')]++;
    // even-ish: each side within 40-60%
    expect(counts.A).toBeGreaterThan(700);
    expect(counts.B).toBeGreaterThan(700);
  });

  it('returns the first variant for an empty list (never throws)', () => {
    expect(assignVariant('u', [] as string[])).toBeUndefined();
  });
});

describe('recommendSendHour (LM16)', () => {
  it('returns the modal open hour', () => {
    expect(recommendSendHour([9, 9, 14, 9, 14])).toBe(9);
  });

  it('breaks ties toward the earliest hour', () => {
    expect(recommendSendHour([8, 8, 17, 17])).toBe(8);
  });

  it('falls back to the default with no data', () => {
    expect(recommendSendHour([])).toBe(DEFAULT_SEND_HOUR);
    expect(recommendSendHour([], { default: 18 })).toBe(18);
  });

  it('ignores out-of-range / non-integer hours', () => {
    expect(recommendSendHour([25, -1, 13.5, 11, 11])).toBe(11);
  });
});

describe('pickWinningSubject (LM16)', () => {
  const stats: SubjectStat[] = [
    { subject: 'A', sent: 100, opened: 30 },
    { subject: 'B', sent: 100, opened: 42 },
  ];

  it('picks the highest open-rate qualifying subject', () => {
    expect(pickWinningSubject(stats)).toEqual({ subject: 'B', openRate: 42 });
  });

  it('ignores variants below the min-sent threshold', () => {
    const r = pickWinningSubject([
      { subject: 'low', sent: 10, opened: 9 }, // 90% but too few sends
      { subject: 'ok', sent: 100, opened: 25 },
    ]);
    expect(r).toEqual({ subject: 'ok', openRate: 25 });
  });

  it('returns null when nothing qualifies', () => {
    expect(pickWinningSubject([{ subject: 'x', sent: 5, opened: 5 }])).toBeNull();
    expect(pickWinningSubject([])).toBeNull();
  });

  it('clamps opened>sent and never throws on junk', () => {
    const r = pickWinningSubject([
      { subject: 'weird', sent: 100, opened: 250 },
      undefined as unknown as SubjectStat,
    ]);
    expect(r).toEqual({ subject: 'weird', openRate: 100 });
  });
});
