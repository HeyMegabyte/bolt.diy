/**
 * Stage 6.1 — the 5-field cron matcher that drives the platform-side scheduled
 * dispatcher (which site crons are due this UTC minute). Pure; no env.
 */
import { cronMatches } from '../cron_match.js';

/** A fixed UTC instant: Thu 2026-01-15 13:07:00 UTC (dow=4 Thursday). */
const T = (iso: string) => new Date(iso);
const ref = T('2026-01-15T13:07:00Z');

describe('cronMatches', () => {
  it('every-minute * * * * * always matches', () => {
    expect(cronMatches('* * * * *', ref)).toBe(true);
    expect(cronMatches('* * * * *', T('2026-06-30T00:00:00Z'))).toBe(true);
  });

  it('top-of-hour 0 * * * * matches :00 only', () => {
    expect(cronMatches('0 * * * *', T('2026-01-15T13:00:00Z'))).toBe(true);
    expect(cronMatches('0 * * * *', ref)).toBe(false); // :07
  });

  it('step */5 matches multiples of 5 minutes', () => {
    expect(cronMatches('*/5 * * * *', T('2026-01-15T13:05:00Z'))).toBe(true);
    expect(cronMatches('*/5 * * * *', T('2026-01-15T13:10:00Z'))).toBe(true);
    expect(cronMatches('*/5 * * * *', ref)).toBe(false); // :07
  });

  it('exact minute + hour', () => {
    expect(cronMatches('7 13 * * *', ref)).toBe(true);
    expect(cronMatches('7 14 * * *', ref)).toBe(false);
    expect(cronMatches('8 13 * * *', ref)).toBe(false);
  });

  it('list of minutes a,b,c', () => {
    expect(cronMatches('5,7,9 * * * *', ref)).toBe(true);
    expect(cronMatches('5,6,8 * * * *', ref)).toBe(false);
  });

  it('range of hours a-b', () => {
    expect(cronMatches('7 9-17 * * *', ref)).toBe(true); // 13 ∈ 9-17
    expect(cronMatches('7 0-6 * * *', ref)).toBe(false);
  });

  it('day-of-month + month', () => {
    expect(cronMatches('7 13 15 1 *', ref)).toBe(true); // 15 Jan
    expect(cronMatches('7 13 16 1 *', ref)).toBe(false);
    expect(cronMatches('7 13 15 2 *', ref)).toBe(false);
  });

  it('day-of-week: Thursday = 4 (and named ranges Mon-Fri = 1-5)', () => {
    expect(cronMatches('7 13 * * 4', ref)).toBe(true); // Thursday
    expect(cronMatches('7 13 * * 1-5', ref)).toBe(true); // weekday
    expect(cronMatches('7 13 * * 0', ref)).toBe(false); // Sunday
    expect(cronMatches('7 13 * * 6,0', ref)).toBe(false); // weekend
  });

  it('Sunday matches both 0 and 7', () => {
    const sun = T('2026-01-18T13:07:00Z'); // Sunday
    expect(cronMatches('7 13 * * 0', sun)).toBe(true);
    expect(cronMatches('7 13 * * 7', sun)).toBe(true);
  });

  it('dom+dow BOTH restricted → OR semantics (either matches)', () => {
    // 15th OR Monday. ref is the 15th (Thu) → matches via dom.
    expect(cronMatches('7 13 15 * 1', ref)).toBe(true);
    // 20th OR Thursday → ref is Thursday → matches via dow.
    expect(cronMatches('7 13 20 * 4', ref)).toBe(true);
    // 20th OR Monday → ref is 15th Thursday → neither.
    expect(cronMatches('7 13 20 * 1', ref)).toBe(false);
  });

  it('malformed → false (wrong field count / garbage token)', () => {
    expect(cronMatches('* * * *', ref)).toBe(false); // 4 fields
    expect(cronMatches('* * * * * *', ref)).toBe(false); // 6 fields
    expect(cronMatches('', ref)).toBe(false);
    expect(cronMatches('abc * * * *', ref)).toBe(false);
    expect(cronMatches('*/0 * * * *', ref)).toBe(false); // zero step
  });
});
