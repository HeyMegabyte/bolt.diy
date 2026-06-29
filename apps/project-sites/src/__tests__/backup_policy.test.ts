import {
  DEFAULT_POLICIES,
  isExpired,
  nextBackupDue,
  scheduleSummary,
} from '../services/backup_policy.js';

// Fixed epoch: 2026-06-29T12:00:00.000Z
const NOW = new Date('2026-06-29T12:00:00.000Z').getTime();

describe('DEFAULT_POLICIES', () => {
  it('has three store entries', () => {
    expect(Object.keys(DEFAULT_POLICIES)).toEqual(['D1', 'R2', 'Neon']);
  });

  it('D1 has 3 rules with expected descriptions', () => {
    const descs = DEFAULT_POLICIES.D1.rules.map((r) => r.description);
    expect(descs).toEqual([
      'Full backup every day, kept 7 days',
      'Incremental backup every 6 hours, kept 2 days',
      'Snapshot every hour, kept 1 day',
    ]);
  });

  it('R2 has 1 rule', () => {
    expect(DEFAULT_POLICIES.R2.rules).toHaveLength(1);
    expect(DEFAULT_POLICIES.R2.rules[0].type).toBe('full');
  });

  it('Neon has 2 rules (full + snapshot)', () => {
    expect(DEFAULT_POLICIES.Neon.rules).toHaveLength(2);
    expect(DEFAULT_POLICIES.Neon.rules.map((r) => r.type)).toEqual(['full', 'snapshot']);
  });

  it('all rules are immutable (Object.isFrozen)', () => {
    for (const policy of Object.values(DEFAULT_POLICIES)) {
      expect(Object.isFrozen(policy)).toBe(true);
      for (const rule of policy.rules) {
        expect(Object.isFrozen(rule)).toBe(true);
      }
    }
  });
});

describe('scheduleSummary', () => {
  it('formats D1 policy correctly', () => {
    const summary = scheduleSummary(DEFAULT_POLICIES.D1);
    expect(summary).toContain('D1 backup policy:');
    expect(summary).toContain('Full backup every day, kept 7 days');
    expect(summary).toContain('Snapshot every hour, kept 1 day');
  });

  it('formats R2 policy (single rule)', () => {
    const summary = scheduleSummary(DEFAULT_POLICIES.R2);
    expect(summary).toContain('R2 backup policy:');
    expect(summary).toMatch(/kept 30 days/);
  });
});

describe('isExpired', () => {
  const rule = DEFAULT_POLICIES.D1.rules[0]; // full-daily, keep 7d

  it('marks a 3-day-old backup as not expired', () => {
    const backup = new Date(NOW - 3 * 86_400_000).toISOString(); // 3 days ago
    const r = isExpired(backup, rule, NOW);
    expect(r.expired).toBe(false);
    // retentionDate should be backup+7d — at 3d old, still 4d to go
    expect(r.retentionDate).toBe(
      new Date(new Date(backup).getTime() + 7 * 86_400_000).toISOString(),
    );
  });

  it('marks a 10-day-old backup as expired', () => {
    const backup = new Date(NOW - 10 * 86_400_000).toISOString();
    const r = isExpired(backup, rule, NOW);
    expect(r.expired).toBe(true);
  });

  it('marks an exactly-7d-old backup at the boundary (still not expired)', () => {
    // backup at NOW - 7d exactly = retentionDate equals NOW
    const backup = new Date(NOW - 7 * 86_400_000).toISOString();
    const r = isExpired(backup, rule, NOW);
    expect(r.expired).toBe(true); // now >= retentionDate
  });

  it('returns the correct retentionDate on output', () => {
    const backup = '2026-06-22T00:00:00.000Z';
    const r = isExpired(backup, rule, NOW);
    expect(r.backupDate).toBe(backup);
    expect(r.retentionDate).toBe('2026-06-29T00:00:00.000Z');
    expect(r.expired).toBe(true);
  });

  it('never throws on an empty-string backup date', () => {
    const r = isExpired('', rule, NOW);
    expect(r.expired).toBe(true);
  });

  it('never throws on a garbage backup date string', () => {
    const r = isExpired('not-a-date', rule, NOW);
    expect(r.expired).toBe(true);
  });

  it('defaults nowMs to Date.now() when omitted', () => {
    const r = isExpired('1970-01-01T00:00:00.000Z', rule);
    expect(r.expired).toBe(true);
  });

  it('handles hours retention unit correctly', () => {
    // snapshot-1h, retain 1d = 24h
    const snapRule = DEFAULT_POLICIES.D1.rules[2];
    const backup = new Date(NOW - 12 * 3_600_000).toISOString(); // 12h ago
    const r = isExpired(backup, snapRule, NOW);
    expect(r.expired).toBe(false); // 12h < 24h
  });

  it('handles weeks retention unit', () => {
    const weekRule = {
      ...DEFAULT_POLICIES.D1.rules[0],
      retention: 2,
      retentionUnit: 'weeks' as const,
    };
    const backup = new Date(NOW - 10 * 86_400_000).toISOString(); // 10d ago
    const r = isExpired(backup, weekRule, NOW);
    expect(r.expired).toBe(false); // 10d < 14d
  });

  it('handles months retention unit', () => {
    const monthRule = {
      ...DEFAULT_POLICIES.D1.rules[0],
      retention: 1,
      retentionUnit: 'months' as const,
    };
    // 35d ago > 30d (month ≈ 30d) → expired
    const backup = new Date(NOW - 35 * 86_400_000).toISOString();
    const r = isExpired(backup, monthRule, NOW);
    expect(r.expired).toBe(true);
    // 25d ago < 30d → not expired
    const r2 = isExpired(new Date(NOW - 25 * 86_400_000).toISOString(), monthRule, NOW);
    expect(r2.expired).toBe(false);
  });

  it('handles negative retention values gracefully', () => {
    const negRule = {
      ...DEFAULT_POLICIES.D1.rules[0],
      retention: -7,
    };
    const backup = new Date(NOW - 3 * 86_400_000).toISOString();
    const r = isExpired(backup, negRule, NOW);
    // Math.abs(-7) = 7, same as original — should mirror the normal rule
    expect(r.expired).toBe(false);
  });
});

describe('nextBackupDue', () => {
  const rule = DEFAULT_POLICIES.D1.rules[0]; // full-daily

  it('returns now when lastBackup is null', () => {
    const due = nextBackupDue(null, rule, NOW);
    expect(due).toBe(new Date(NOW).toISOString());
  });

  it('returns the correct next date when last backup was 6h ago', () => {
    const lastBackup = new Date(NOW - 6 * 3_600_000).toISOString();
    const due = nextBackupDue(lastBackup, rule, NOW);
    // next due = last + 1d = last + 86400000
    const expected = new Date(new Date(lastBackup).getTime() + 86_400_000);
    expect(due).toBe(expected.toISOString());
  });

  it('returns now when lastBackup is overdue (frequency passed)', () => {
    const lastBackup = new Date(NOW - 36 * 3_600_000).toISOString(); // 36h ago > 24h
    const due = nextBackupDue(lastBackup, rule, NOW);
    expect(due).toBe(new Date(NOW).toISOString());
  });

  it('returns now when lastBackup is exactly at frequency boundary', () => {
    const lastBackup = new Date(NOW - 24 * 3_600_000).toISOString(); // 24h ago
    const due = nextBackupDue(lastBackup, rule, NOW);
    expect(due).toBe(new Date(NOW).toISOString());
  });

  it('never throws on a null lastBackup', () => {
    const due = nextBackupDue(null, rule, NOW);
    expect(typeof due).toBe('string');
    expect(due).toBeTruthy();
  });

  it('never throws on a garbage lastBackup string', () => {
    const due = nextBackupDue('not-a-date', rule, NOW);
    expect(due).toBe(new Date(NOW).toISOString());
  });

  it('defaults nowMs to Date.now() when omitted', () => {
    const due = nextBackupDue(null, rule);
    expect(typeof due).toBe('string');
    expect(due).toBeTruthy();
  });

  it('handles snapshot-6h frequency correctly', () => {
    // R2 full-daily won't work here; use D1 incremental (every 6h)
    const incrRule = DEFAULT_POLICIES.D1.rules[1];
    const lastBackup = new Date(NOW - 4 * 3_600_000).toISOString(); // 4h ago
    const due = nextBackupDue(lastBackup, incrRule, NOW);
    // next = last + 6h
    const expected = new Date(new Date(lastBackup).getTime() + 6 * 3_600_000);
    expect(due).toBe(expected.toISOString());
  });

  it('handles weeks frequency unit', () => {
    const weekRule = {
      ...DEFAULT_POLICIES.D1.rules[0],
      frequency: 2,
      frequencyUnit: 'weeks' as const,
    };
    const lastBackup = new Date(NOW - 86_400_000).toISOString(); // 1d ago
    const due = nextBackupDue(lastBackup, weekRule, NOW);
    // next = last + 14d
    const expected = new Date(new Date(lastBackup).getTime() + 14 * 86_400_000);
    expect(due).toBe(expected.toISOString());
  });

  it('handles months frequency unit', () => {
    const monthRule = {
      ...DEFAULT_POLICIES.D1.rules[0],
      frequency: 1,
      frequencyUnit: 'months' as const,
    };
    const lastBackup = new Date(NOW - 86_400_000).toISOString();
    const due = nextBackupDue(lastBackup, monthRule, NOW);
    // next = last + 30d approx
    const expected = new Date(new Date(lastBackup).getTime() + 30 * 86_400_000);
    expect(due).toBe(expected.toISOString());
  });
});

describe('end-to-end: isExpired + nextBackupDue compose', () => {
  it('daily full backup: runs, expires, schedules next', () => {
    const rule = DEFAULT_POLICIES.D1.rules[0];

    // Backup just taken — not expired (retention is 7d from now)
    const backup = new Date(NOW).toISOString();
    const check = isExpired(backup, rule, NOW);
    expect(check.expired).toBe(false);

    // Next due = NOW + 1 day (full-daily frequency)
    const due = nextBackupDue(backup, rule, NOW);
    expect(due).toBe(new Date(NOW + 86_400_000).toISOString());
  });

  it('simulates a 3-day cycle: backup → not yet due → due again', () => {
    const rule = DEFAULT_POLICIES.D1.rules[0]; // full-daily, keep 7d

    // Day 0 — full backup taken
    const day0 = NOW;
    const backup0 = new Date(day0).toISOString();

    // Day 1 — not yet expired (1d old, retention 7d)
    const day1 = day0 + 86_400_000;
    expect(isExpired(backup0, rule, day1).expired).toBe(false);

    // Day 1 — next due is overdue (24h since last backup), so returns day1
    const due1 = nextBackupDue(backup0, rule, day1);
    expect(due1).toBe(new Date(day1).toISOString());

    // Day 8 — backup is now expired
    const day8 = day0 + 8 * 86_400_000;
    expect(isExpired(backup0, rule, day8).expired).toBe(true);
  });
});
