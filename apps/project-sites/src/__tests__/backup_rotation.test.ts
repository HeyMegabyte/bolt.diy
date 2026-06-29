import {
  applyRotation,
  DEFAULT_POLICIES,
  rotationSummary,
  type Backup,
} from '../services/backup_rotation.js';

// Fixed epoch: 2026-06-29T12:00:00.000Z
const NOW = new Date('2026-06-29T12:00:00.000Z').getTime();

function backup(over: Partial<Backup> = {}): Backup {
  return {
    id: 'b1',
    type: 'full',
    createdAt: new Date(NOW - 1 * 86_400_000).toISOString(), // 1 day ago
    sizeBytes: 1_000_000,
    ...over,
  };
}

const SECOND = 1000;
const HOUR = 3600_000;
const DAY = 86_400_000;

describe('DEFAULT_POLICIES', () => {
  it('has three store entries in order', () => {
    expect(Object.keys(DEFAULT_POLICIES)).toEqual(['d1', 'neon', 'r2']);
  });

  it('D1 retains 7 full + 14 incremental, max 30 days', () => {
    expect(DEFAULT_POLICIES.d1).toEqual({ keepFull: 7, keepIncremental: 14, maxAgeDays: 30 });
  });

  it('R2 retains 30 full + 0 incremental, max 90 days', () => {
    expect(DEFAULT_POLICIES.r2).toEqual({ keepFull: 30, keepIncremental: 0, maxAgeDays: 90 });
  });

  it('Neon retains 14 full + 7 incremental, max 45 days', () => {
    expect(DEFAULT_POLICIES.neon).toEqual({ keepFull: 14, keepIncremental: 7, maxAgeDays: 45 });
  });

  it('all policies are immutable (Object.isFrozen)', () => {
    for (const policy of Object.values(DEFAULT_POLICIES)) {
      expect(Object.isFrozen(policy)).toBe(true);
    }
  });
});

describe('applyRotation — age capping', () => {
  it('keeps a recent backup within the age cap', () => {
    const b = backup(); // 1 day old, d1 maxAge=30d → within
    const result = applyRotation([b], DEFAULT_POLICIES.d1, NOW);
    expect(result.keep).toHaveLength(1);
    expect(result.delete).toHaveLength(0);
    expect(result.keep[0].id).toBe('b1');
  });

  it('deletes a backup older than maxAgeDays', () => {
    const b = backup({ createdAt: new Date(NOW - 31 * DAY).toISOString() }); // 31d > 30d
    const result = applyRotation([b], DEFAULT_POLICIES.d1, NOW);
    expect(result.keep).toHaveLength(0);
    expect(result.delete).toHaveLength(1);
    expect(result.delete[0].id).toBe('b1');
  });

  it('treats a backup exactly at the age boundary as within the cap (not deleted)', () => {
    const b = backup({ createdAt: new Date(NOW - 30 * DAY + SECOND).toISOString() }); // 30d - 1s < 30d
    const result = applyRotation([b], DEFAULT_POLICIES.d1, NOW);
    expect(result.keep).toHaveLength(1);
  });

  it('deletes all backups when all are expired', () => {
    const backups = [
      backup({ id: 'old1', createdAt: new Date(NOW - 60 * DAY).toISOString() }),
      backup({
        id: 'old2',
        type: 'incremental',
        createdAt: new Date(NOW - 50 * DAY).toISOString(),
      }),
    ];
    const result = applyRotation(backups, DEFAULT_POLICIES.d1, NOW);
    expect(result.keep).toHaveLength(0);
    expect(result.delete).toHaveLength(2);
  });

  it('handles an empty backup list', () => {
    const result = applyRotation([], DEFAULT_POLICIES.d1, NOW);
    expect(result.keep).toHaveLength(0);
    expect(result.delete).toHaveLength(0);
  });

  it('handles a backup with an unparseable createdAt (isNaN age) by deleting it', () => {
    const b = backup({ createdAt: 'not-a-date' });
    const result = applyRotation([b], DEFAULT_POLICIES.d1, NOW);
    expect(result.keep).toHaveLength(0);
    expect(result.delete).toHaveLength(1);
  });

  it('defaults nowMs to Date.now() when omitted', () => {
    const b = backup({ createdAt: '1970-01-01T00:00:00.000Z' }); // 56+ years old
    const result = applyRotation([b], DEFAULT_POLICIES.d1);
    expect(result.keep).toHaveLength(0);
    expect(result.delete).toHaveLength(1);
  });
});

describe('applyRotation — count capping per type', () => {
  function manyFull(n: number, offset: number = 0): Backup[] {
    return Array.from({ length: n }, (_, i) =>
      backup({
        id: `full-${i}`,
        type: 'full',
        createdAt: new Date(NOW - (i + 1 + offset) * DAY).toISOString(),
      }),
    );
  }

  function manyIncremental(n: number, offset: number = 0): Backup[] {
    return Array.from({ length: n }, (_, i) =>
      backup({
        id: `inc-${i}`,
        type: 'incremental',
        createdAt: new Date(NOW - (i + 1 + offset) * HOUR).toISOString(),
      }),
    );
  }

  it('keeps up to keepFull full backups, deletes the rest', () => {
    const all = manyFull(10); // 10 fulls, but D1 keeps only 7
    const result = applyRotation(all, DEFAULT_POLICIES.d1, NOW);
    expect(result.keep).toHaveLength(7);
    expect(result.delete).toHaveLength(3);
  });

  it('keeps the newest fulls when there are more than keepFull', () => {
    const all = manyFull(5, 10); // 5 fulls offset by 10 days
    const policy = { keepFull: 2, keepIncremental: 0, maxAgeDays: 365 };
    const result = applyRotation(all, policy, NOW);
    expect(result.keep).toHaveLength(2);
    // Newest = most recent created = smallest i + smallest offset
    expect(result.keep[0].id).toBe('full-0');
    expect(result.keep[1].id).toBe('full-1');
  });

  it('keeps up to keepIncremental incremental backups, deletes the rest', () => {
    const all = manyIncremental(20); // 20 incrementals, but D1 keeps 14
    const result = applyRotation(all, DEFAULT_POLICIES.d1, NOW);
    expect(result.keep).toHaveLength(14);
    expect(result.delete).toHaveLength(6);
  });

  it('keeps all backups when counts are under the policy limits', () => {
    const all = [
      backup({ id: 'f1', type: 'full' }),
      backup({ id: 'f2', type: 'full' }),
      backup({ id: 'i1', type: 'incremental' }),
    ];
    const result = applyRotation(all, DEFAULT_POLICIES.d1, NOW);
    expect(result.keep).toHaveLength(3);
    expect(result.delete).toHaveLength(0);
  });

  it('keeps zero incrementals when keepIncremental is 0', () => {
    const all = manyIncremental(5);
    const result = applyRotation(all, DEFAULT_POLICIES.r2, NOW); // R2: keepIncremental=0
    expect(result.keep).toHaveLength(0);
    expect(result.delete).toHaveLength(5); // all deleted
  });

  it('returns keeps ordered newest-first', () => {
    const all = manyFull(7);
    const result = applyRotation(all, DEFAULT_POLICIES.d1, NOW);
    for (let i = 1; i < result.keep.length; i++) {
      const prev = new Date(result.keep[i - 1].createdAt).getTime();
      const curr = new Date(result.keep[i].createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

describe('applyRotation — mixed types', () => {
  it('keeps correct counts when full and incremental are interleaved', () => {
    const backups: Backup[] = [
      backup({ id: 'f1', type: 'full', createdAt: new Date(NOW - 1 * DAY).toISOString() }),
      backup({ id: 'i1', type: 'incremental', createdAt: new Date(NOW - 2 * HOUR).toISOString() }),
      backup({ id: 'f2', type: 'full', createdAt: new Date(NOW - 2 * DAY).toISOString() }),
      backup({ id: 'i2', type: 'incremental', createdAt: new Date(NOW - 3 * HOUR).toISOString() }),
      backup({ id: 'f3', type: 'full', createdAt: new Date(NOW - 4 * DAY).toISOString() }),
    ];
    const result = applyRotation(backups, DEFAULT_POLICIES.d1, NOW);
    expect(result.keep.map((b) => b.id).sort()).toEqual(['f1', 'f2', 'f3', 'i1', 'i2']);
    expect(result.delete).toHaveLength(0);
  });

  it('respects per-type limits with mixed interleaved backups', () => {
    // keepFull=2, keepIncremental=1
    const policy: import('../services/backup_rotation.js').RotationPolicy = {
      keepFull: 2,
      keepIncremental: 1,
      maxAgeDays: 30,
    };
    const backups: Backup[] = [
      backup({ id: 'f1', type: 'full', createdAt: new Date(NOW - 1 * DAY).toISOString() }),
      backup({ id: 'f2', type: 'full', createdAt: new Date(NOW - 2 * DAY).toISOString() }),
      backup({ id: 'f3', type: 'full', createdAt: new Date(NOW - 3 * DAY).toISOString() }),
      backup({ id: 'i1', type: 'incremental', createdAt: new Date(NOW - 1 * HOUR).toISOString() }),
      backup({ id: 'i2', type: 'incremental', createdAt: new Date(NOW - 2 * HOUR).toISOString() }),
    ];
    const result = applyRotation(backups, policy, NOW);
    // Keep newest 2 fulls (f1, f2) + newest 1 incremental (i1)
    const keptIds = result.keep.map((b) => b.id).sort();
    expect(keptIds).toEqual(['f1', 'f2', 'i1']);
    const deletedIds = result.delete.map((b) => b.id).sort();
    expect(deletedIds).toEqual(['f3', 'i2']);
  });
});

describe('rotationSummary', () => {
  it('formats a mix of kept and deleted', () => {
    const msg = rotationSummary({
      keep: [{ id: 'a', type: 'full', createdAt: '', sizeBytes: 0 }],
      delete: [{ id: 'b', type: 'incremental', createdAt: '', sizeBytes: 0 }],
    });
    expect(msg).toBe('Kept 1, deleted 1 backup(s).');
  });

  it('formats keep-only', () => {
    const msg = rotationSummary({
      keep: [{ id: 'a', type: 'full', createdAt: '', sizeBytes: 0 }],
      delete: [],
    });
    expect(msg).toBe('Kept 1, deleted 0 backup(s).');
  });

  it('formats delete-only', () => {
    const msg = rotationSummary({
      keep: [],
      delete: [{ id: 'a', type: 'full', createdAt: '', sizeBytes: 0 }],
    });
    expect(msg).toBe('Kept 0, deleted 1 backup(s).');
  });

  it('returns a sensible message for empty result', () => {
    const msg = rotationSummary({ keep: [], delete: [] });
    expect(msg).toBe('No backups to rotate.');
  });
});
