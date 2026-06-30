import { teamUsageStats, topUsers, trackTeamUsage, type TeamUsageEvent } from '../team_usage';

const ORG_A = 'org_abc';
const ORG_B = 'org_xyz';
const USER_1 = 'user_001';
const USER_2 = 'user_002';
const USER_3 = 'user_003';

describe('trackTeamUsage', () => {
  it('creates a TeamUsageEvent with the given fields', () => {
    const e = trackTeamUsage(ORG_A, USER_1, 'site.published');

    expect(e).toEqual({
      action: 'site.published',
      id: expect.any(String),
      orgId: ORG_A,
      timestamp: expect.any(String),
      userId: USER_1,
    });
  });

  it('generates a UUID for the id field', () => {
    const e = trackTeamUsage(ORG_A, USER_1, 'site.created');

    expect(e.id).toEqual(expect.any(String));
    expect(e.id.length).toBeGreaterThan(0);
  });

  it('generates unique ids for successive calls', () => {
    const e1 = trackTeamUsage(ORG_A, USER_1, 'site.created');
    const e2 = trackTeamUsage(ORG_A, USER_1, 'site.published');

    expect(e1.id).not.toBe(e2.id);
  });

  it('sets a valid ISO 8601 timestamp by default', () => {
    const e = trackTeamUsage(ORG_A, USER_1, 'site.created');

    expect(() => new Date(e.timestamp)).not.toThrow();
    expect(new Date(e.timestamp).toISOString()).toBe(e.timestamp);
  });

  it('accepts an explicit timestamp', () => {
    const ts = '2026-01-15T10:30:00.000Z';
    const e = trackTeamUsage(ORG_A, USER_1, 'domain.added', ts);

    expect(e.timestamp).toBe(ts);
  });

  it('preserves orgId and userId exactly', () => {
    const e = trackTeamUsage(ORG_B, USER_2, 'site.created');

    expect(e.orgId).toBe(ORG_B);
    expect(e.userId).toBe(USER_2);
    expect(e.orgId).not.toBe(ORG_A);
    expect(e.userId).not.toBe(USER_1);
  });
});

describe('teamUsageStats', () => {
  it('returns zeroed stats when no events match the orgId', () => {
    const e1: TeamUsageEvent = {
      action: 'site.created',
      id: 'id-1',
      orgId: ORG_B,
      timestamp: '2026-01-01T00:00:00.000Z',
      userId: USER_1,
    };

    const stats = teamUsageStats([e1], ORG_A);

    expect(stats).toEqual({ byAction: {}, dateRange: null, total: 0, uniqueUsers: 0 });
  });

  it('returns zeroed stats when the input is empty', () => {
    const stats = teamUsageStats([], ORG_A);

    expect(stats).toEqual({ byAction: {}, dateRange: null, total: 0, uniqueUsers: 0 });
  });

  it('counts total events per org', () => {
    const events = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z'],
      [ORG_A, USER_2, 'site.published', '2026-06-15T12:00:00.000Z'],
      [ORG_B, USER_1, 'site.created', '2026-06-15T12:00:00.000Z'],
    ]);

    const stats = teamUsageStats(events, ORG_A);

    expect(stats.total).toBe(2);
  });

  it('excludes events from other orgs', () => {
    const events = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z'],
      [ORG_B, USER_1, 'site.published', '2026-06-15T12:00:00.000Z'],
    ]);

    const stats = teamUsageStats(events, ORG_A);

    expect(stats.byAction).not.toHaveProperty('site.published');
  });

  it('breaks down counts by action', () => {
    const events = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z'],
      [ORG_A, USER_1, 'site.published', '2026-06-15T12:00:00.000Z'],
      [ORG_A, USER_2, 'site.created', '2026-06-20T00:00:00.000Z'],
    ]);

    const stats = teamUsageStats(events, ORG_A);

    expect(stats.byAction).toEqual({
      'site.created': 2,
      'site.published': 1,
    });
  });

  it('counts unique users', () => {
    const events = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z'],
      [ORG_A, USER_1, 'site.published', '2026-06-15T12:00:00.000Z'],
      [ORG_A, USER_2, 'site.created', '2026-06-20T00:00:00.000Z'],
    ]);

    const stats = teamUsageStats(events, ORG_A);

    expect(stats.uniqueUsers).toBe(2);
  });

  it('reports the date range across matching events', () => {
    const events = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z'],
      [ORG_A, USER_1, 'site.published', '2026-06-15T12:00:00.000Z'],
    ]);

    const stats = teamUsageStats(events, ORG_A);

    expect(stats.dateRange).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-06-15T12:00:00.000Z',
    });
  });

  it('returns same from/to when only one event matches', () => {
    const events = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-06-15T12:00:00.000Z'],
      [ORG_B, USER_1, 'site.published', '2026-01-01T00:00:00.000Z'],
    ]);

    const stats = teamUsageStats(events, ORG_A);

    expect(stats.dateRange).toEqual({
      from: '2026-06-15T12:00:00.000Z',
      to: '2026-06-15T12:00:00.000Z',
    });
  });

  it('handles a single matching event', () => {
    const events = buildEvents([[ORG_A, USER_1, 'site.created', '2026-06-15T12:00:00.000Z']]);

    const stats = teamUsageStats(events, ORG_A);

    expect(stats.total).toBe(1);
    expect(stats.uniqueUsers).toBe(1);
  });

  it('handles all events in the same org', () => {
    const events = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z'],
      [ORG_A, USER_1, 'site.published', '2026-06-15T12:00:00.000Z'],
      [ORG_A, USER_2, 'domain.added', '2026-12-31T23:59:59.000Z'],
    ]);

    const stats = teamUsageStats(events, ORG_A);

    expect(stats.total).toBe(3);
    expect(stats.uniqueUsers).toBe(2);
  });

  it('accepts a readonly input array', () => {
    const readonly: readonly TeamUsageEvent[] = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z'],
    ]);

    const stats = teamUsageStats(readonly, ORG_A);

    expect(stats.total).toBe(1);
  });

  it('returns a new object each call', () => {
    const events = buildEvents([[ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z']]);

    const a = teamUsageStats(events, ORG_A);
    const b = teamUsageStats(events, ORG_A);

    expect(a).not.toBe(b);
  });

  it('handles many events of the same action', () => {
    const events = buildEvents(
      Array.from({ length: 100 }, (_, i) => [
        ORG_A,
        USER_1,
        'build.completed',
        `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      ]),
    );

    const stats = teamUsageStats(events, ORG_A);

    expect(stats.total).toBe(100);
    expect(stats.byAction['build.completed']).toBe(100);
    expect(stats.uniqueUsers).toBe(1);
  });
});

describe('topUsers', () => {
  it('returns users ranked by event count descending', () => {
    const events = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z'],
      [ORG_A, USER_1, 'site.published', '2026-06-15T12:00:00.000Z'],
      [ORG_A, USER_2, 'site.created', '2026-06-20T00:00:00.000Z'],
    ]);

    const top = topUsers(events, ORG_A);

    expect(top[0]).toEqual({ userId: USER_1, count: 2 });
    expect(top[1]).toEqual({ userId: USER_2, count: 1 });
  });

  it('excludes users from other orgs', () => {
    const events = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z'],
      [ORG_B, USER_2, 'site.published', '2026-06-15T12:00:00.000Z'],
    ]);

    const top = topUsers(events, ORG_A);

    expect(top).toHaveLength(1);
    expect(top[0].userId).toBe(USER_1);
  });

  it('returns an empty array when no events match', () => {
    const events = buildEvents([[ORG_B, USER_1, 'site.created', '2026-01-01T00:00:00.000Z']]);

    expect(topUsers(events, ORG_A)).toEqual([]);
  });

  it('returns an empty array when the input is empty', () => {
    expect(topUsers([], ORG_A)).toEqual([]);
  });

  it('defaults to top 10 when topN is omitted', () => {
    const events = buildEvents(
      Array.from({ length: 15 }, (_, i) => [
        ORG_A,
        `user_${String(i + 1).padStart(3, '0')}`,
        'site.created',
        '2026-01-01T00:00:00.000Z',
      ]),
    );

    const top = topUsers(events, ORG_A);

    expect(top).toHaveLength(10);
  });

  it('respects a custom topN parameter', () => {
    const events = buildEvents(
      Array.from({ length: 15 }, (_, i) => [
        ORG_A,
        `user_${String(i + 1).padStart(3, '0')}`,
        'site.created',
        '2026-01-01T00:00:00.000Z',
      ]),
    );

    const top = topUsers(events, ORG_A, 3);

    expect(top).toHaveLength(3);
  });

  it('sets a ceiling of topN, not a floor', () => {
    const events = buildEvents([[ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z']]);

    const top = topUsers(events, ORG_A, 10);

    expect(top).toHaveLength(1);
  });

  it('handles zero topN', () => {
    const events = buildEvents([[ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z']]);

    const top = topUsers(events, ORG_A, 0);

    expect(top).toEqual([]);
  });

  it('handles negative topN', () => {
    const events = buildEvents([[ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z']]);

    const top = topUsers(events, ORG_A, -1);

    expect(top).toEqual([]);
  });

  it('sorts by descending count even when users are tied', () => {
    const events = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z'],
      [ORG_A, USER_2, 'site.published', '2026-06-15T12:00:00.000Z'],
      [ORG_A, USER_1, 'site.published', '2026-06-20T00:00:00.000Z'],
      [ORG_A, USER_3, 'build.started', '2026-06-25T00:00:00.000Z'],
    ]);

    const top = topUsers(events, ORG_A);

    expect(top[0]).toEqual({ userId: USER_1, count: 2 });
    // USER_2 and USER_3 both have count 1 — order among ties is stable
    // but unspecified; just assert both are present
    expect(top).toContainEqual({ userId: USER_2, count: 1 });
    expect(top).toContainEqual({ userId: USER_3, count: 1 });
  });

  it('accepts a readonly input array', () => {
    const readonly: readonly TeamUsageEvent[] = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z'],
    ]);

    const top = topUsers(readonly, ORG_A);

    expect(top).toHaveLength(1);
    expect(top[0].userId).toBe(USER_1);
  });

  it('mutating the returned array does not affect the input', () => {
    const events = buildEvents([
      [ORG_A, USER_1, 'site.created', '2026-01-01T00:00:00.000Z'],
      [ORG_A, USER_2, 'site.published', '2026-06-15T12:00:00.000Z'],
    ]);

    const top = topUsers(events, ORG_A);
    expect(top).toHaveLength(2);

    top.pop();
    expect(events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Helper: build typed events from tuple arrays
// ---------------------------------------------------------------------------

function buildEvents(tuples: Array<[string, string, string, string]>): TeamUsageEvent[] {
  return tuples.map(([orgId, userId, action, timestamp], i) => ({
    action,
    id: `id-${i}`,
    orgId,
    timestamp,
    userId,
  }));
}
