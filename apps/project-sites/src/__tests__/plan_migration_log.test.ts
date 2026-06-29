/**
 * @module __tests__/plan_migration_log
 * @description Unit tests for plan migration log (logMigration, migrationHistory, migrationStats).
 */

import {
  logMigration,
  migrationHistory,
  migrationStats,
} from '../services/plan_migration_log.js';

describe('plan_migration_log', () => {
  // -----------------------------------------------------------------------
  // logMigration
  // -----------------------------------------------------------------------
  describe('logMigration', () => {
    it('creates a MigrationLog with required fields', () => {
      const entry = logMigration('org_1', 'free', 'starter', 750);

      expect(entry.id).toBeDefined();
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.orgId).toBe('org_1');
      expect(entry.from).toBe('free');
      expect(entry.to).toBe('starter');
      expect(entry.proration).toBe(750);
    });

    it('generates a unique id per call', () => {
      const a = logMigration('org_1', 'free', 'starter', 0);
      const b = logMigration('org_1', 'free', 'starter', 0);
      expect(a.id).not.toBe(b.id);
    });

    it('generates an ISO timestamp when date is omitted', () => {
      const entry = logMigration('org_1', 'free', 'starter', 0);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(() => new Date(entry.date)).not.toThrow();
    });

    it('accepts an explicit date via the optional parameter', () => {
      const t = '2026-01-15T00:00:00.000Z';
      const entry = logMigration('org_1', 'pro', 'enterprise', 5000, t);
      expect(entry.date).toBe(t);
    });

    it('accepts zero proration', () => {
      const entry = logMigration('org_1', 'free', 'free', 0);
      expect(entry.proration).toBe(0);
    });

    it('accepts negative proration (refund)', () => {
      const entry = logMigration('org_1', 'pro', 'free', -1500);
      expect(entry.proration).toBe(-1500);
    });
  });

  // -----------------------------------------------------------------------
  // migrationHistory
  // -----------------------------------------------------------------------
  describe('migrationHistory', () => {
    it('returns only entries matching the org', () => {
      const a = logMigration('org_1', 'free', 'starter', 0, '2026-01-01T00:00:00Z');
      const b = logMigration('org_2', 'starter', 'pro', 0, '2026-01-02T00:00:00Z');
      const c = logMigration('org_1', 'pro', 'free', 0, '2026-01-03T00:00:00Z');

      const filtered = migrationHistory([a, b, c], 'org_1');
      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.orgId === 'org_1')).toBe(true);
    });

    it('returns empty array when no entries match', () => {
      const entry = logMigration('org_1', 'free', 'starter', 0, '2026-01-01T00:00:00Z');
      expect(migrationHistory([entry], 'org_2')).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      expect(migrationHistory([], 'org_1')).toEqual([]);
    });

    it('returns a new array reference (never the original)', () => {
      const items = [
        logMigration('org_1', 'free', 'starter', 0, '2026-01-01T00:00:00Z'),
      ];
      const result = migrationHistory(items, 'org_1');
      expect(result).not.toBe(items);
      expect(result).toEqual(items);
    });

    it('does not mutate the original array', () => {
      const items = [
        logMigration('org_1', 'free', 'starter', 0, '2026-01-01T00:00:00Z'),
        logMigration('org_2', 'starter', 'pro', 0, '2026-01-02T00:00:00Z'),
      ];
      const copy = [...items];
      migrationHistory(items, 'org_1');
      expect(items).toEqual(copy);
    });
  });

  // -----------------------------------------------------------------------
  // migrationStats
  // -----------------------------------------------------------------------
  describe('migrationStats', () => {
    it('counts upgrades and downgrades correctly', () => {
      const stats = migrationStats([
        logMigration('org_1', 'free', 'starter', 0, '2026-01-01T00:00:00Z'),
        logMigration('org_2', 'free', 'pro', 0, '2026-01-02T00:00:00Z'),
        logMigration('org_3', 'pro', 'free', 0, '2026-01-03T00:00:00Z'),
        logMigration('org_4', 'starter', 'pro', 0, '2026-01-04T00:00:00Z'),
        logMigration('org_5', 'pro', 'starter', 0, '2026-01-05T00:00:00Z'),
      ]);
      expect(stats.total).toBe(5);
      expect(stats.upgrades).toBe(3); // free→starter, free→pro, starter→pro
      expect(stats.downgrades).toBe(2); // pro→free, pro→starter
    });

    it('treats same-plan transitions as neither upgrade nor downgrade', () => {
      const stats = migrationStats([
        logMigration('org_1', 'starter', 'starter', 0, '2026-01-01T00:00:00Z'),
        logMigration('org_2', 'pro', 'pro', 0, '2026-01-02T00:00:00Z'),
      ]);
      expect(stats.total).toBe(2);
      expect(stats.upgrades).toBe(0);
      expect(stats.downgrades).toBe(0);
    });

    it('returns zeros for empty input', () => {
      const stats = migrationStats([]);
      expect(stats.total).toBe(0);
      expect(stats.upgrades).toBe(0);
      expect(stats.downgrades).toBe(0);
    });

    it('treats unknown plan slugs as lowest tier', () => {
      const stats = migrationStats([
        // unknown→free should be a downgrade (free is tier 0, unknown is -1)
        logMigration('org_1', 'unknown_plan', 'free', 0, '2026-01-01T00:00:00Z'),
        // free→unknown should be an upgrade (free=0, unknown=-1 → not >0, but equal)
        // Actually: 0 vs -1, -1 < 0 → downgrade, not upgrade
        // Let me reconsider: from=free (0), to=unknown (-1) → -1 < 0 → downgrade
        logMigration('org_2', 'free', 'unknown_plan', 0, '2026-01-02T00:00:00Z'),
      ]);
      // unknown→free: from=-1, to=0 → 0 > -1 → upgrade
      // free→unknown: from=0, to=-1 → -1 < 0 → downgrade
      expect(stats.total).toBe(2);
      expect(stats.upgrades).toBe(1);
      expect(stats.downgrades).toBe(1);
    });

    it('handles a single entry', () => {
      const stats = migrationStats([
        logMigration('org_1', 'free', 'pro', 2500, '2026-01-01T00:00:00Z'),
      ]);
      expect(stats.total).toBe(1);
      expect(stats.upgrades).toBe(1);
      expect(stats.downgrades).toBe(0);
    });

    it('handles all upgrades', () => {
      const stats = migrationStats([
        logMigration('org_1', 'free', 'starter', 0, '2026-01-01T00:00:00Z'),
        logMigration('org_2', 'free', 'pro', 0, '2026-01-02T00:00:00Z'),
        logMigration('org_3', 'starter', 'pro', 0, '2026-01-03T00:00:00Z'),
      ]);
      expect(stats.total).toBe(3);
      expect(stats.upgrades).toBe(3);
      expect(stats.downgrades).toBe(0);
    });

    it('handles all downgrades', () => {
      const stats = migrationStats([
        logMigration('org_1', 'pro', 'free', 0, '2026-01-01T00:00:00Z'),
        logMigration('org_2', 'starter', 'free', 0, '2026-01-02T00:00:00Z'),
        logMigration('org_3', 'pro', 'starter', 0, '2026-01-03T00:00:00Z'),
      ]);
      expect(stats.total).toBe(3);
      expect(stats.upgrades).toBe(0);
      expect(stats.downgrades).toBe(3);
    });
  });
});
