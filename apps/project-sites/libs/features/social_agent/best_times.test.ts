/**
 * bestPostingTimes — the static heuristic behind `GET /api/social/best-times`
 * (the admin Social composer's "best time" chips, previously a 404). Locks the
 * label SHAPE the client's chip parser depends on (`/^(\w{3})\s+(\d{1,2})(am|pm)/`)
 * + the 24h→12h conversion + platform lookup + unknown-slug tolerance.
 */
import { bestPostingTimes } from './service.js';

describe('bestPostingTimes', () => {
  const CHIP = /^(\w{3})\s+(\d{1,2})(am|pm)$/;

  it('returns "Day 12h" labels the composer chip parser accepts', () => {
    const out = bestPostingTimes(['linkedin']);
    expect(out.length).toBeGreaterThan(0);
    for (const label of out) expect(label).toMatch(CHIP);
    // linkedin bestDays[0]=Tue, bestTimes=['08:00','12:00','17:00'] → Tue 8am, Wed 12pm, Thu 5pm.
    expect(out).toEqual(['Tue 8am', 'Wed 12pm', 'Thu 5pm']);
  });

  it('converts 24h → 12h correctly (midnight/noon boundaries)', () => {
    // x: bestTimes ['09:00','12:00','17:00'] paired with bestDays ['Mon','Tue','Wed'].
    expect(bestPostingTimes(['x'])).toEqual(['Mon 9am', 'Tue 12pm', 'Wed 5pm']);
  });

  it('de-duplicates across multiple platforms, preserving order', () => {
    const out = bestPostingTimes(['x', 'linkedin']);
    expect(new Set(out).size).toBe(out.length); // no dupes
    expect(out[0]).toBe('Mon 9am'); // x first
  });

  it('ignores unknown platform slugs (never throws)', () => {
    expect(bestPostingTimes(['not-a-platform', 'linkedin'])).toEqual([
      'Tue 8am',
      'Wed 12pm',
      'Thu 5pm',
    ]);
    expect(bestPostingTimes(['garbage'])).toEqual([]);
  });

  it('returns [] for an empty platform list', () => {
    expect(bestPostingTimes([])).toEqual([]);
  });
});
