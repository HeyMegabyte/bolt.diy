import {
  buildTrigger,
  isDue,
  scheduleNext,
  intervalMs,
  parseCronExpr,
  WORKFLOW_TRIGGERS,
  type WorkflowTrigger,
} from '../services/workflow_schedule.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const NOW = 1_000 * DAY; // arbitrary fixed "now"

describe('WORKFLOW_TRIGGERS', () => {
  it('has the three required entries', () => {
    expect(WORKFLOW_TRIGGERS).toEqual({
      site_cleanup: 'weekly',
      analytics_rollup: 'daily',
      backup_rotation: 'daily',
    });
  });
});

describe('intervalMs', () => {
  it('resolves named intervals', () => {
    expect(intervalMs('hourly')).toBe(HOUR);
    expect(intervalMs('daily')).toBe(DAY);
    expect(intervalMs('weekly')).toBe(WEEK);
  });

  it('resolves daily cron expressions', () => {
    expect(intervalMs('0 3 * * *')).toBe(DAY);
  });

  it('resolves weekly cron expressions', () => {
    expect(intervalMs('0 3 * * 0')).toBe(WEEK);
    expect(intervalMs('0 3 * * 6')).toBe(WEEK);
  });

  it('resolves hourly cron expressions', () => {
    expect(intervalMs('0 * * * *')).toBe(HOUR);
  });

  it('throws on unrecognised cron strings', () => {
    expect(() => intervalMs('')).toThrow(RangeError);
    expect(() => intervalMs('*/15 * * * *')).toThrow(RangeError);
    expect(() => intervalMs('0 3 15 * *')).toThrow(RangeError);
    expect(() => intervalMs('bogus')).toThrow(RangeError);
  });
});

describe('parseCronExpr', () => {
  it('returns null for incomplete expressions', () => {
    expect(parseCronExpr('')).toBeNull();
    expect(parseCronExpr('0 3 * *')).toBeNull();
  });

  it('returns daily for midnight-style daily crons', () => {
    expect(parseCronExpr('0 0 * * *')).toBe(DAY);
    expect(parseCronExpr('0 23 * * *')).toBe(DAY);
  });

  it('returns weekly for day-of-week crons', () => {
    expect(parseCronExpr('0 3 * * 0')).toBe(WEEK);
    expect(parseCronExpr('0 3 * * 6')).toBe(WEEK);
    expect(parseCronExpr('0 12 * * 1')).toBe(WEEK);
  });

  it('returns hourly for zero-minute every-hour crons', () => {
    expect(parseCronExpr('0 * * * *')).toBe(HOUR);
  });

  it('returns null for sub-hour intervals', () => {
    expect(parseCronExpr('*/5 * * * *')).toBeNull();
    expect(parseCronExpr('30 * * * *')).toBeNull();
  });

  it('returns null for day-of-month crons', () => {
    expect(parseCronExpr('0 3 15 * *')).toBeNull();
  });
});

describe('buildTrigger', () => {
  it('creates a fresh trigger with no run history', () => {
    const t = buildTrigger('site_cleanup', 'weekly');
    expect(t.workflow).toBe('site_cleanup');
    expect(t.cron).toBe('weekly');
    expect(t.nextRun).toBeNull();
    expect(t.lastRun).toBeNull();
    expect(t.enabled).toBe(true);
  });

  it('accepts any cron descriptor', () => {
    const t = buildTrigger('my_workflow', '0 3 * * *');
    expect(t.cron).toBe('0 3 * * *');
  });
});

describe('isDue', () => {
  it('returns true when nextRun is null (never scheduled)', () => {
    expect(isDue(buildTrigger('w', 'daily'))).toBe(true);
  });

  it('returns true when nextRun is in the past', () => {
    const t: WorkflowTrigger = {
      workflow: 'w',
      cron: 'daily',
      nextRun: String(NOW - HOUR),
      lastRun: String(NOW - DAY - HOUR),
      enabled: true,
    };
    expect(isDue(t, NOW)).toBe(true);
  });

  it('returns false when nextRun is in the future', () => {
    const t: WorkflowTrigger = {
      workflow: 'w',
      cron: 'daily',
      nextRun: String(NOW + HOUR),
      lastRun: String(NOW),
      enabled: true,
    };
    expect(isDue(t, NOW)).toBe(false);
  });

  it('returns false when nextRun equals now (exact boundary treated as due)', () => {
    const t: WorkflowTrigger = {
      workflow: 'w',
      cron: 'daily',
      nextRun: String(NOW),
      lastRun: String(NOW - DAY),
      enabled: true,
    };
    expect(isDue(t, NOW)).toBe(true);
  });

  it('returns false when disabled', () => {
    const t = buildTrigger('w', 'daily');
    t.enabled = false;
    expect(isDue(t)).toBe(false);
  });

  it('uses Date.now() when nowMs not provided', () => {
    const t = buildTrigger('w', 'daily');
    // nextRun null → due regardless of Date.now()
    expect(isDue(t)).toBe(true);
  });
});

describe('scheduleNext', () => {
  it('sets lastRun to now and computes nextRun based on cron interval', () => {
    const t = scheduleNext(buildTrigger('cleanup', 'daily'), NOW);
    expect(t.lastRun).toBe(String(NOW));
    expect(t.nextRun).toBe(String(NOW + DAY));
    expect(t.workflow).toBe('cleanup');
    expect(t.cron).toBe('daily');
    expect(t.enabled).toBe(true);
  });

  it('handles weekly interval', () => {
    const t = scheduleNext(buildTrigger('cleanup', 'weekly'), NOW);
    expect(t.nextRun).toBe(String(NOW + WEEK));
  });

  it('handles hourly interval', () => {
    const t = scheduleNext(buildTrigger('cleanup', 'hourly'), NOW);
    expect(t.nextRun).toBe(String(NOW + HOUR));
  });

  it('preserves existing fields not related to scheduling', () => {
    const t = scheduleNext(
      {
        workflow: 'backup_rotation',
        cron: 'daily',
        nextRun: null,
        lastRun: null,
        enabled: true,
      },
      NOW,
    );
    expect(t.workflow).toBe('backup_rotation');
    expect(t.enabled).toBe(true);
  });

  it('chains: scheduleNext then isDue returns false', () => {
    const t = scheduleNext(buildTrigger('cleanup', 'daily'), NOW);
    expect(isDue(t, NOW)).toBe(false);
    // After interval passes, due again
    expect(isDue(t, NOW + DAY)).toBe(true);
  });

  it('uses Date.now() when nowMs not provided', () => {
    const t = scheduleNext(buildTrigger('cleanup', 'daily'));
    expect(t.lastRun).not.toBeNull();
    expect(t.nextRun).not.toBeNull();
    expect(Number(t.nextRun)).toBeGreaterThan(Number(t.lastRun));
  });

  it('throws on unresolvable cron', () => {
    expect(() => scheduleNext(buildTrigger('w', '*/5 * * * *'), NOW)).toThrow(RangeError);
    expect(() => scheduleNext(buildTrigger('w', 'bogus'), NOW)).toThrow(RangeError);
  });
});
