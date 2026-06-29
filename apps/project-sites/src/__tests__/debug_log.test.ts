import {
  LOG_LEVELS,
  LOG_LEVEL_RANK,
  shouldLog,
  createLogEntry,
  filterLogs,
} from '../services/debug_log.js';

describe('debug_log', () => {
  // -----------------------------------------------------------------------
  // LOG_LEVELS
  // -----------------------------------------------------------------------
  describe('LOG_LEVELS', () => {
    it('contains all six levels in ascending order', () => {
      expect(LOG_LEVELS).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
    });

    // NOTE: `as const` is a compile-time readonly constraint, not Object.freeze.
    // Runtime mutation is not tested — the type system enforces it.
  });

  // -----------------------------------------------------------------------
  // LOG_LEVEL_RANK
  // -----------------------------------------------------------------------
  describe('LOG_LEVEL_RANK', () => {
    it('assigns 0..5 in ascending order, alphabetical keys', () => {
      expect(LOG_LEVEL_RANK).toEqual({
        debug: 1,
        error: 4,
        fatal: 5,
        info: 2,
        trace: 0,
        warn: 3,
      });
    });

    it('every LOG_LEVELS entry has a rank', () => {
      const ranks = LOG_LEVELS.map((l) => LOG_LEVEL_RANK[l]);
      expect(ranks).toEqual([0, 1, 2, 3, 4, 5]);
    });
  });

  // -----------------------------------------------------------------------
  // shouldLog
  // -----------------------------------------------------------------------
  describe('shouldLog', () => {
    it('returns true when level equals threshold', () => {
      expect(shouldLog('info', 'info')).toBe(true);
    });

    it('returns true when level is above threshold', () => {
      expect(shouldLog('error', 'warn')).toBe(true);
      expect(shouldLog('fatal', 'trace')).toBe(true);
    });

    it('returns false when level is below threshold', () => {
      expect(shouldLog('debug', 'info')).toBe(false);
      expect(shouldLog('trace', 'warn')).toBe(false);
    });

    it('works with lowest and highest levels', () => {
      expect(shouldLog('trace', 'fatal')).toBe(false);
      expect(shouldLog('fatal', 'trace')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // createLogEntry
  // -----------------------------------------------------------------------
  describe('createLogEntry', () => {
    it('creates a basic entry with all fields', () => {
      const entry = createLogEntry('info', 'Hello', { key: 1 }, 'tid-1');
      expect(entry).toEqual({
        context: { key: 1 },
        level: 'info',
        message: 'Hello',
        timestamp: '',
        traceId: 'tid-1',
      });
    });

    it('defaults context to {} when omitted', () => {
      const entry = createLogEntry('warn', 'Something');
      expect(entry.context).toEqual({});
    });

    it('defaults traceId to "" when omitted', () => {
      const entry = createLogEntry('error', 'Boom');
      expect(entry.traceId).toBe('');
    });

    it('uses empty object when context is undefined explicitly', () => {
      const entry = createLogEntry('fatal', 'Crash', undefined, 'tid-2');
      expect(entry.context).toEqual({});
    });

    it('preserves an empty context object', () => {
      const entry = createLogEntry('trace', 'Start', {});
      expect(entry.context).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // filterLogs
  // -----------------------------------------------------------------------
  describe('filterLogs', () => {
    const entries = [
      createLogEntry('info', 'Site created', { slug: 'a' }, 't1'),
      createLogEntry('warn', 'Build slow', { duration: 42 }, 't1'),
      createLogEntry('error', 'Build failed', {}, 't2'),
      createLogEntry('debug', 'Started poll', { cycle: 3 }, 't2'),
      createLogEntry('info', 'Site published', { slug: 'b' }, 't3'),
    ] as const;

    // Assign deterministic timestamps so string comparison works.
    const withTimestamps = entries.map((e, i) => ({
      ...e,
      timestamp: `2026-06-${String(28 + i).padStart(2, '0')}T12:00:00Z`,
    }));

    it('returns a new array (never mutates input)', () => {
      const result = filterLogs(withTimestamps, {});
      expect(result).not.toBe(withTimestamps);
      expect(result).toEqual(withTimestamps);
    });

    describe('minLevel', () => {
      it('filters below warn', () => {
        const result = filterLogs(withTimestamps, { minLevel: 'warn' });
        expect(result).toHaveLength(2);
        expect(result.map((e) => e.level)).toEqual(['warn', 'error']);
      });

      it('retains everything for trace threshold', () => {
        const result = filterLogs(withTimestamps, { minLevel: 'trace' });
        expect(result).toHaveLength(withTimestamps.length);
      });

      it('returns nothing above fatal threshold', () => {
        const result = filterLogs(withTimestamps, { minLevel: 'fatal' });
        expect(result).toHaveLength(0);
      });
    });

    describe('traceId', () => {
      it('filters by exact traceId', () => {
        const result = filterLogs(withTimestamps, { traceId: 't2' });
        expect(result).toHaveLength(2);
        expect(result.every((e) => e.traceId === 't2')).toBe(true);
      });

      it('returns empty for unknown traceId', () => {
        const result = filterLogs(withTimestamps, { traceId: 'nope' });
        expect(result).toHaveLength(0);
      });
    });

    describe('since', () => {
      it('filters entries on or after a timestamp', () => {
        const result = filterLogs(withTimestamps, {
          since: '2026-06-30T12:00:00Z',
        });
        // Indices 2, 3, 4 have timestamps 2026-06-30/31/32
        expect(result).toHaveLength(3);
        expect(result.every((e) => e.timestamp >= '2026-06-30T12:00:00Z')).toBe(true);
      });

      it('returns nothing for future date', () => {
        const result = filterLogs(withTimestamps, {
          since: '2027-01-01T00:00:00Z',
        });
        expect(result).toHaveLength(0);
      });
    });

    describe('search', () => {
      it('filters by case-insensitive substring in message', () => {
        const result = filterLogs(withTimestamps, { search: 'build' });
        expect(result).toHaveLength(2);
        expect(result.map((e) => e.message)).toEqual(['Build slow', 'Build failed']);
      });

      it('returns nothing when search matches nothing', () => {
        const result = filterLogs(withTimestamps, { search: 'zzz' });
        expect(result).toHaveLength(0);
      });

      it('handles empty search string (no filter)', () => {
        const result = filterLogs(withTimestamps, { search: '' });
        expect(result).toHaveLength(withTimestamps.length);
      });
    });

    describe('combined filters (AND)', () => {
      it('applies minLevel + traceId together', () => {
        const result = filterLogs(withTimestamps, {
          minLevel: 'info',
          traceId: 't1',
        });
        expect(result).toHaveLength(2);
        expect(result.every((e) => e.traceId === 't1')).toBe(true);
        expect(result.every((e) => LOG_LEVEL_RANK[e.level] >= 2)).toBe(true);
      });

      it('applies all four filters', () => {
        // Only "Site published" (info, t3, 2026-07-01) matches all.
        const result = filterLogs(withTimestamps, {
          minLevel: 'info',
          traceId: 't3',
          since: '2026-06-01T00:00:00Z',
          search: 'published',
        });
        expect(result).toHaveLength(1);
        expect(result[0]!.message).toBe('Site published');
      });
    });
  });
});
