import {
  ACTIVITY_ICONS,
  ACTIVITY_TYPES,
  activitySummary,
  createActivity,
  filterBySite,
  isActivityType,
  type ActivityType,
} from '../services/activity_log.js';

describe('activity_log', () => {
  // -----------------------------------------------------------------------
  // isActivityType
  // -----------------------------------------------------------------------
  describe('isActivityType', () => {
    it('returns true for every known type', () => {
      for (const t of ACTIVITY_TYPES) {
        expect(isActivityType(t)).toBe(true);
      }
    });

    it('returns false for an unknown string', () => {
      expect(isActivityType('nope')).toBe(false);
      expect(isActivityType('')).toBe(false);
      expect(isActivityType('site.unknown')).toBe(false);
    });

    it('rejects a structurally similar but misspelled type', () => {
      expect(isActivityType('build.complet')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // ACTIVITY_ICONS
  // -----------------------------------------------------------------------
  describe('ACTIVITY_ICONS', () => {
    it('has an entry for every ActivityType', () => {
      for (const t of ACTIVITY_TYPES) {
        expect(typeof ACTIVITY_ICONS[t]).toBe('string');
        expect(ACTIVITY_ICONS[t].length).toBeGreaterThan(0);
      }
    });

    it('each icon is a single emoji (surrogate pair or code point)', () => {
      for (const t of ACTIVITY_TYPES) {
        const icon = ACTIVITY_ICONS[t];
        expect([...icon].length).toBe(1); // one Unicode code point
      }
    });

    it('returns the same icon for the same type every time', () => {
      expect(ACTIVITY_ICONS['site.published']).toBe(ACTIVITY_ICONS['site.published']);
    });
  });

  // -----------------------------------------------------------------------
  // ACTIVITY_TYPES — const array integrity
  // -----------------------------------------------------------------------
  describe('ACTIVITY_TYPES', () => {
    it('is readonly and frozen', () => {
      expect(Object.isFrozen(ACTIVITY_TYPES)).toBe(true);
    });

    it('contains no duplicates', () => {
      expect(new Set(ACTIVITY_TYPES).size).toBe(ACTIVITY_TYPES.length);
    });
  });

  // -----------------------------------------------------------------------
  // createActivity
  // -----------------------------------------------------------------------
  describe('createActivity', () => {
    it('creates an Activity with required fields', () => {
      const a = createActivity('site.created', 'user_1', 'Site created');

      expect(a.id).toBeDefined();
      expect(typeof a.id).toBe('string');
      expect(a.id.length).toBeGreaterThan(0);
      expect(a.type).toBe('site.created');
      expect(a.userId).toBe('user_1');
      expect(a.message).toBe('Site created');
    });

    it('creates an Activity with provided metadata', () => {
      const meta = { slug: 'my-site', orgId: 'org_abc' };
      const a = createActivity('build.started', 'user_2', 'Building…', meta);

      expect(a.metadata).toEqual(meta);
      expect(a.metadata).not.toBe(meta); // a copy, not the same ref
    });

    it('defaults metadata to {} when omitted', () => {
      const a = createActivity('lead.claimed', 'user_3', 'Lead claimed');
      expect(a.metadata).toEqual({});
    });

    it('generates a unique id per call', () => {
      const a1 = createActivity('team.invited', 'u1', '');
      const a2 = createActivity('team.invited', 'u1', '');
      expect(a1.id).not.toBe(a2.id);
    });

    it('generates an ISO timestamp', () => {
      const a = createActivity('site.published', 'u1', '');
      // ISO 8601: 2026-06-29T…
      expect(a.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      // Must be parseable as a valid Date.
      expect(() => new Date(a.timestamp)).not.toThrow();
    });

    it('accepts explicit timestamp via the optional parameter', () => {
      const t1 = '2026-01-01T00:00:00.000Z';
      const t2 = '2026-06-01T00:00:00.000Z';
      const a1 = createActivity('site.created', 'u1', '', {}, undefined, t1);
      const a2 = createActivity('site.created', 'u1', '', {}, undefined, t2);
      expect(a1.timestamp).toBe(t1);
      expect(a2.timestamp).toBe(t2);
    });

    it('sets siteId when provided', () => {
      const a = createActivity('domain.added', 'u1', 'Domain added', {}, 'site_42');
      expect(a.siteId).toBe('site_42');
    });

    it('omits siteId when not provided', () => {
      const a = createActivity('domain.added', 'u1', 'Domain added');
      expect(a.siteId).toBeUndefined();
    });

    it('accepts all known ActivityType values', () => {
      const types: ActivityType[] = [
        'site.created',
        'site.published',
        'domain.added',
        'billing.upgraded',
        'build.started',
        'build.completed',
        'build.failed',
        'lead.claimed',
        'team.invited',
      ];
      for (const t of types) {
        const a = createActivity(t, 'u1', 'test');
        expect(a.type).toBe(t);
      }
    });
  });

  // -----------------------------------------------------------------------
  // activitySummary
  // -----------------------------------------------------------------------
  describe('activitySummary', () => {
    it('returns empty string for an empty list', () => {
      expect(activitySummary([])).toBe('');
    });

    it('describes a single activity', () => {
      const a = createActivity('build.completed', 'u1', 'Done');
      expect(activitySummary([a])).toBe('1 activity: build.completed');
    });

    it('describes two activities', () => {
      const a1 = createActivity('site.created', 'u1', '');
      const a2 = createActivity('site.published', 'u1', '');
      const summary = activitySummary([a1, a2]);
      expect(summary).toMatch(/^2 activities:/);
      expect(summary).toContain('site.created');
      expect(summary).toContain('site.published');
    });

    it('describes N activities', () => {
      const items = Array.from({ length: 5 }, (_, i) =>
        createActivity('build.started', `u${i}`, ''),
      );
      expect(activitySummary(items)).toMatch(/^5 activities: build\.started/);
    });

    it('handles a 1-element array correctly (plurality)', () => {
      const a = createActivity('domain.added', 'u1', '');
      expect(activitySummary([a])).toBe('1 activity: domain.added');
    });
  });

  // -----------------------------------------------------------------------
  // filterBySite
  // -----------------------------------------------------------------------
  describe('filterBySite', () => {
    const makeActivity = (type: ActivityType, siteId: string) =>
      createActivity(type, 'u1', '', {}, siteId);

    it('returns only activities matching the site', () => {
      const a1 = makeActivity('site.published', 'site_1');
      const a2 = makeActivity('build.completed', 'site_2');
      const a3 = makeActivity('site.created', 'site_1');

      const filtered = filterBySite([a1, a2, a3], 'site_1');
      expect(filtered).toHaveLength(2);
      expect(filtered.every((a) => a.siteId === 'site_1')).toBe(true);
    });

    it('returns empty array when no activities match', () => {
      const a = makeActivity('lead.claimed', 'site_1');
      expect(filterBySite([a], 'site_2')).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      expect(filterBySite([], 'site_1')).toEqual([]);
    });

    it('returns a new array reference (never the original)', () => {
      const items = [makeActivity('team.invited', 'site_1')];
      const result = filterBySite(items, 'site_1');
      expect(result).not.toBe(items);
      expect(result).toEqual(items);
    });

    it('does not mutate the original array', () => {
      const items = [
        makeActivity('site.published', 'site_1'),
        makeActivity('build.failed', 'site_2'),
      ];
      const copy = [...items];
      filterBySite(items, 'site_1');
      expect(items).toEqual(copy); // unchanged
    });

    it('handles activities with no siteId (undefined)', () => {
      const a1 = createActivity('billing.upgraded', 'u1', 'Upgraded');
      const a2 = makeActivity('site.created', 'site_1');
      // undefined siteId should never match a specific siteId string
      const filtered = filterBySite([a1, a2], 'site_1');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].siteId).toBe('site_1');
    });
  });
});
