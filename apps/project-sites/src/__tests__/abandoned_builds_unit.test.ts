import {
  selectAbandonedBuilds,
  FINISHED_STATUSES,
  type BuildRow,
} from '../services/abandoned_builds.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_000 * DAY; // arbitrary fixed "now"

function row(over: Partial<BuildRow> = {}): BuildRow {
  return {
    siteId: 's1',
    orgId: 'o1',
    status: 'published',
    finishedAtMs: NOW - 3 * DAY, // 3 days ago — inside default window
    claimed: false,
    nudgedAtMs: null,
    ...over,
  };
}

describe('selectAbandonedBuilds', () => {
  it('selects a finished, unclaimed, never-nudged build inside the window', () => {
    expect(selectAbandonedBuilds([row()], NOW).map((r) => r.siteId)).toEqual(['s1']);
  });

  it('excludes claimed (converted) builds', () => {
    expect(selectAbandonedBuilds([row({ claimed: true })], NOW)).toEqual([]);
  });

  it('excludes non-finished statuses', () => {
    expect(selectAbandonedBuilds([row({ status: 'generating' })], NOW)).toEqual([]);
    expect(selectAbandonedBuilds([row({ status: 'error' })], NOW)).toEqual([]);
  });

  it('excludes too-young builds (< minAge) and too-old builds (> maxAge)', () => {
    expect(selectAbandonedBuilds([row({ finishedAtMs: NOW - 1 * HOUR })], NOW)).toEqual([]); // 1h < 24h
    expect(selectAbandonedBuilds([row({ finishedAtMs: NOW - 30 * DAY })], NOW)).toEqual([]); // 30d > 14d
  });

  it('throttles: skips a build nudged within reNudgeMs, allows one nudged longer ago', () => {
    expect(selectAbandonedBuilds([row({ nudgedAtMs: NOW - 2 * DAY })], NOW)).toEqual([]); // 2d < 7d
    expect(
      selectAbandonedBuilds([row({ nudgedAtMs: NOW - 8 * DAY })], NOW).map((r) => r.siteId),
    ).toEqual(['s1']);
  });

  it('honours custom window + throttle options', () => {
    const r = row({ finishedAtMs: NOW - 2 * HOUR });
    // default minAge 24h excludes it; lower minAge to 1h includes it
    expect(selectAbandonedBuilds([r], NOW, { minAgeMs: 1 * HOUR })).toHaveLength(1);
  });

  it('preserves input order + filters a mixed batch', () => {
    const rows = [
      row({ siteId: 'keep1' }),
      row({ siteId: 'claimed', claimed: true }),
      row({ siteId: 'young', finishedAtMs: NOW - 1 * HOUR }),
      row({ siteId: 'keep2' }),
    ];
    expect(selectAbandonedBuilds(rows, NOW).map((r) => r.siteId)).toEqual(['keep1', 'keep2']);
  });

  it('FINISHED_STATUSES covers the published/finished/complete set', () => {
    expect(FINISHED_STATUSES.has('published')).toBe(true);
    expect(FINISHED_STATUSES.has('finished')).toBe(true);
    expect(FINISHED_STATUSES.has('complete')).toBe(true);
    expect(FINISHED_STATUSES.has('draft')).toBe(false);
  });
});
