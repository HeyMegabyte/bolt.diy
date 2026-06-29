import {
  type CleanupFile,
  type CleanupRule,
  DEFAULT_RULES,
  matchCleanup,
} from '../file_cleanup';

/** 1 day in milliseconds. */
const ONE_DAY = 86_400_000;
/** 7 days in milliseconds. */
const SEVEN_DAYS = 7 * ONE_DAY;

/** Fresh file (modified now). */
const FRESH: CleanupFile = { name: 'src/index.ts', mtimeMs: Date.now() };
/** File older than 1 day, younger than 7. */
const OLD_1D: CleanupFile = { name: 'build.tmp', mtimeMs: Date.now() - ONE_DAY - 60_000 };
/** File older than 7 days. */
const OLD_7D: CleanupFile = { name: 'exports/report.csv', mtimeMs: Date.now() - SEVEN_DAYS - 60_000 };
/** File that matches no default rule. */
const UNMATCHED: CleanupFile = { name: 'assets/logo.png', mtimeMs: Date.now() - ONE_DAY * 30 };

describe('DEFAULT_RULES', () => {
  it('has exactly two frozen rules', () => {
    expect(DEFAULT_RULES).toHaveLength(2);
    expect(DEFAULT_RULES[0]).toEqual({ pattern: '*.tmp', maxAgeDays: 1 });
    expect(DEFAULT_RULES[1]).toEqual({ pattern: 'exports/*', maxAgeDays: 7 });
  });

  it('is deeply frozen (Object.freeze)', () => {
    expect(() => { (DEFAULT_RULES as typeof DEFAULT_RULES & { push: unknown }).push = () => {}; }).toThrow();
    expect(() => { (DEFAULT_RULES[0] as { pattern: string }).pattern = ''; }).toThrow();
  });
});

describe('matchCleanup', () => {
  describe('empty / edge inputs', () => {
    it('returns empty keep and delete for empty files array', () => {
      const result = matchCleanup([]);
      expect(result).toEqual({ keep: [], delete: [] });
    });

    it('returns all files as keep when no rules match', () => {
      const files = [FRESH, { name: 'data.json', mtimeMs: Date.now() - ONE_DAY * 365 }];
      const result = matchCleanup(files, []);
      expect(result.keep).toHaveLength(2);
      expect(result.delete).toHaveLength(0);
    });

    it('keeps all files that match no rule regardless of age', () => {
      const files = [UNMATCHED, { name: 'readme.md', mtimeMs: Date.now() - ONE_DAY * 365 }];
      const result = matchCleanup(files, [{ pattern: '*.zip', maxAgeDays: 1 }]);
      expect(result.keep).toHaveLength(2);
      expect(result.delete).toHaveLength(0);
    });

    it('returns empty keep when all files are deleted', () => {
      const files: CleanupFile[] = [
        { name: 'a.tmp', mtimeMs: Date.now() - ONE_DAY * 2 },
      ];
      const result = matchCleanup(files, [{ pattern: '*.tmp', maxAgeDays: 1 }]);
      expect(result.keep).toHaveLength(0);
      expect(result.delete).toHaveLength(1);
    });
  });

  describe('default rules', () => {
    it('deletes *.tmp files older than 1 day, keeps younger ones', () => {
      const recentTmp: CleanupFile = { name: 'cache.tmp', mtimeMs: Date.now() - 60_000 };
      const staleTmp: CleanupFile = { name: 'old.tmp', mtimeMs: Date.now() - ONE_DAY * 2 };

      const { keep, delete: del } = matchCleanup([recentTmp, staleTmp]);
      expect(keep).toHaveLength(1);
      expect(keep[0].name).toBe('cache.tmp');
      expect(del).toHaveLength(1);
      expect(del[0].name).toBe('old.tmp');
    });

    it('deletes exports/* files older than 7 days, keeps younger ones', () => {
      const recentExport: CleanupFile = { name: 'exports/report.csv', mtimeMs: Date.now() - ONE_DAY * 3 };
      const staleExport: CleanupFile = { name: 'exports/old.csv', mtimeMs: Date.now() - SEVEN_DAYS * 2 };

      const { keep, delete: del } = matchCleanup([recentExport, staleExport]);
      expect(keep).toHaveLength(1);
      expect(keep[0].name).toBe('exports/report.csv');
      expect(del).toHaveLength(1);
      expect(del[0].name).toBe('exports/old.csv');
    });
  });

  describe('custom rules', () => {
    it('deletes files matching any rule that exceeds maxAgeDays', () => {
      const rule: CleanupRule = { pattern: '*.log', maxAgeDays: 3 };
      const files: CleanupFile[] = [
        { name: 'server.log', mtimeMs: Date.now() - ONE_DAY * 5 },
        { name: 'recent.log', mtimeMs: Date.now() - ONE_DAY * 1 },
        { name: 'notes.txt', mtimeMs: Date.now() - ONE_DAY * 10 },
      ];

      const { keep, delete: del } = matchCleanup(files, [rule]);
      expect(keep).toHaveLength(2);
      expect(keep.map((f) => f.name).sort()).toEqual(['notes.txt', 'recent.log']);
      expect(del).toHaveLength(1);
      expect(del[0].name).toBe('server.log');
    });

    it('deletes when at least one matching rule exceeds age (union semantics)', () => {
      const rules: CleanupRule[] = [
        { pattern: '*.csv', maxAgeDays: 1 },
        { pattern: 'exports/*', maxAgeDays: 30 },
      ];
      // File matches both rules. Age (3 days) exceeds the 1-day rule but not
      // the 30-day rule. Still deleted because *any* matching rule can authorise.
      const file: CleanupFile = { name: 'exports/data.csv', mtimeMs: Date.now() - ONE_DAY * 3 };

      const { keep, delete: del } = matchCleanup([file], rules);
      expect(keep).toHaveLength(0);
      expect(del).toHaveLength(1);
      expect(del[0].name).toBe('exports/data.csv');
    });

    it('keeps files whose age is within all matching rules', () => {
      const rules: CleanupRule[] = [
        { pattern: 'exports/*', maxAgeDays: 7 },
        { pattern: '*.csv', maxAgeDays: 14 },
      ];
      const file: CleanupFile = { name: 'exports/data.csv', mtimeMs: Date.now() - ONE_DAY * 3 };

      const { keep, delete: del } = matchCleanup([file], rules);
      expect(keep).toHaveLength(1);
      expect(del).toHaveLength(0);
    });
  });

  describe('pattern matching edge cases', () => {
    it('matches patterns anchored to file name (not path substring)', () => {
      const files: CleanupFile[] = [
        { name: 'exports/notes.tmp', mtimeMs: Date.now() - ONE_DAY * 5 },
      ];
      // *.tmp should match any file ending in .tmp regardless of directory.
      const { delete: del } = matchCleanup(files, [{ pattern: '*.tmp', maxAgeDays: 1 }]);
      expect(del).toHaveLength(1);
    });

    it('pattern with ? matches single character', () => {
      const files: CleanupFile[] = [
        { name: 'file1.txt', mtimeMs: Date.now() - ONE_DAY * 5 },
        { name: 'fileA.txt', mtimeMs: Date.now() - ONE_DAY * 5 },
        { name: 'file12.txt', mtimeMs: Date.now() - ONE_DAY * 5 },
      ];
      const { delete: del } = matchCleanup(files, [{ pattern: 'file?.txt', maxAgeDays: 1 }]);
      expect(del).toHaveLength(2);
      expect(del.map((f) => f.name).sort()).toEqual(['file1.txt', 'fileA.txt']);
    });

    it('pattern with literal dot matches only literal dot', () => {
      const files: CleanupFile[] = [
        { name: 'data.tmp', mtimeMs: Date.now() - ONE_DAY * 5 },
        { name: 'dataXtmp', mtimeMs: Date.now() - ONE_DAY * 5 },
      ];
      const { delete: del } = matchCleanup(files, [{ pattern: '*.tmp', maxAgeDays: 1 }]);
      expect(del).toHaveLength(1);
      expect(del[0].name).toBe('data.tmp');
    });
  });

  describe('immutability', () => {
    it('does not mutate the input files array', () => {
      const files: CleanupFile[] = [FRESH, OLD_1D];
      const copy = [...files];
      matchCleanup(files);
      expect(files).toEqual(copy);
    });

    it('returns new arrays (not references to input)', () => {
      const files: CleanupFile[] = [FRESH];
      const result = matchCleanup(files);
      expect(result.keep).not.toBe(files);
    });
  });
});
