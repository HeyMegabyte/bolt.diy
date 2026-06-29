import { activityFeed, type MemberActivity, recordActivity } from '../member_activity';

const ORG_A = 'org_abc';
const ORG_B = 'org_xyz';
const USER_1 = 'user_001';
const USER_2 = 'user_002';

describe('recordActivity', () => {
  it('creates a MemberActivity with the given fields', () => {
    const a = recordActivity(ORG_A, USER_1, 'site.published');

    expect(a).toEqual({
      action: 'site.published',
      orgId: ORG_A,
      timestamp: expect.any(String),
      userId: USER_1,
    });
  });

  it('sets a valid ISO 8601 timestamp by default', () => {
    const a = recordActivity(ORG_A, USER_1, 'site.created');

    expect(() => new Date(a.timestamp)).not.toThrow();
    expect(new Date(a.timestamp).toISOString()).toBe(a.timestamp);
  });

  it('accepts an explicit timestamp', () => {
    const ts = '2026-01-15T10:30:00.000Z';
    const a = recordActivity(ORG_A, USER_1, 'domain.added', ts);

    expect(a.timestamp).toBe(ts);
  });

  it('accepts different action strings', () => {
    const actions = [
      'site.published',
      'domain.added',
      'billing.upgraded',
      'build.completed',
      'build.failed',
      'team.invited',
    ];

    for (const action of actions) {
      const a = recordActivity(ORG_A, USER_1, action);
      expect(a.action).toBe(action);
    }
  });

  it('preserves orgId and userId exactly', () => {
    const a = recordActivity(ORG_B, USER_2, 'site.created');

    expect(a.orgId).toBe(ORG_B);
    expect(a.userId).toBe(USER_2);
    expect(a.orgId).not.toBe(ORG_A);
    expect(a.userId).not.toBe(USER_1);
  });

  it('returned object is immutable at type level (readonly fields)', () => {
    const a: MemberActivity = recordActivity(ORG_A, USER_1, 'site.published');
    // All fields are readonly — assignment should be a TS error.
    // Runtime check: the value is set correctly.
    expect(a.orgId).toBe(ORG_A);
  });
});

describe('activityFeed', () => {
  const EARLY = '2026-01-01T00:00:00.000Z';
  const MID = '2026-06-15T12:00:00.000Z';
  const LATE = '2026-12-31T23:59:59.000Z';

  const a1: MemberActivity = {
    action: 'site.created',
    orgId: ORG_A,
    timestamp: EARLY,
    userId: USER_1,
  };
  const a2: MemberActivity = {
    action: 'site.published',
    orgId: ORG_A,
    timestamp: MID,
    userId: USER_2,
  };
  const a3: MemberActivity = {
    action: 'billing.upgraded',
    orgId: ORG_A,
    timestamp: LATE,
    userId: USER_1,
  };
  const b1: MemberActivity = {
    action: 'site.created',
    orgId: ORG_B,
    timestamp: MID,
    userId: USER_1,
  };

  it('returns activities matching the given orgId', () => {
    const feed = activityFeed([a1, a2, a3, b1], ORG_A);

    expect(feed).toHaveLength(3);
    expect(feed.every((a) => a.orgId === ORG_A)).toBe(true);
  });

  it('excludes activities from other orgs', () => {
    const feed = activityFeed([a1, a2, a3, b1], ORG_A);

    expect(feed.find((a) => a.orgId === ORG_B)).toBeUndefined();
  });

  it('sorts activities newest-first by timestamp', () => {
    const feed = activityFeed([a1, a2, a3, b1], ORG_A);

    expect(feed[0]).toBe(a3); // LATE
    expect(feed[1]).toBe(a2); // MID
    expect(feed[2]).toBe(a1); // EARLY
  });

  it('returns a new array, never the original reference', () => {
    const activities: MemberActivity[] = [a1, a2, a3];
    const feed = activityFeed(activities, ORG_A);

    expect(feed).not.toBe(activities);
    expect(Array.isArray(feed)).toBe(true);
  });

  it('mutating the returned array does not affect the input', () => {
    const activities: MemberActivity[] = [a1, a2, a3];
    const feed = activityFeed(activities, ORG_A);

    feed.pop();
    expect(activities).toHaveLength(3);
  });

  it('returns an empty array when the input is empty', () => {
    expect(activityFeed([], ORG_A)).toEqual([]);
  });

  it('returns an empty array when no activities match the orgId', () => {
    expect(activityFeed([b1], ORG_A)).toEqual([]);
  });

  it('accepts a readonly input array', () => {
    const readonly: readonly MemberActivity[] = [a1, a2, a3];
    const feed = activityFeed(readonly, ORG_A);

    expect(feed).toHaveLength(3);
  });

  it('handles a single matching activity', () => {
    const feed = activityFeed([a1, b1], ORG_A);

    expect(feed).toHaveLength(1);
    expect(feed[0]).toBe(a1);
  });

  it('handles all activities in the same org', () => {
    const feed = activityFeed([a1, a2, a3], ORG_A);

    expect(feed).toHaveLength(3);
  });

  it('filters for a different org correctly', () => {
    const feed = activityFeed([a1, a2, a3, b1], ORG_B);

    expect(feed).toHaveLength(1);
    expect(feed[0]).toBe(b1);
  });
});
