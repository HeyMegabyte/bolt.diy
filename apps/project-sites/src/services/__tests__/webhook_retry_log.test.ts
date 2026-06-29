import {
  logAttempt,
  retryStats,
  type RetryLogEntry,
  type RetryStats,
} from '../webhook_retry_log';

const NOW = '2026-06-29T12:00:00.000Z';
const LATER = '2026-06-29T12:05:00.000Z';

const STUB_DELIVERED: RetryLogEntry = {
  webhookId: 'wh_abc',
  attempt: 1,
  status: 'delivered',
  error: null,
  ts: NOW,
};

const STUB_FAILED: RetryLogEntry = {
  webhookId: 'wh_abc',
  attempt: 1,
  status: 'failed',
  error: 'ECONNREFUSED',
  ts: NOW,
};

describe('logAttempt', () => {
  it('appends an entry to an empty array', () => {
    const result = logAttempt([], STUB_DELIVERED);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(STUB_DELIVERED);
  });

  it('appends an entry to a non-empty array', () => {
    const first = logAttempt([], STUB_DELIVERED);
    const second: RetryLogEntry = {
      webhookId: 'wh_abc',
      attempt: 2,
      status: 'failed',
      error: 'TIMEOUT',
      ts: LATER,
    };
    const result = logAttempt(first, second);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(STUB_DELIVERED);
    expect(result[1]).toEqual(second);
  });

  it('does not mutate the input array', () => {
    const input: RetryLogEntry[] = [STUB_DELIVERED];
    const copy = [...input];
    logAttempt(input, STUB_FAILED);

    expect(input).toEqual(copy);
    expect(input).toHaveLength(1);
  });

  it('returns a different reference from the input array', () => {
    const input: RetryLogEntry[] = [STUB_DELIVERED];
    const result = logAttempt(input, STUB_FAILED);

    expect(result).not.toBe(input);
  });

  it('can record multiple entries for the same webhookId', () => {
    const retries: RetryLogEntry[] = [
      STUB_FAILED,
      { webhookId: 'wh_abc', attempt: 2, status: 'failed', error: 'RETRY_LIMIT', ts: LATER },
    ];
    const result = logAttempt(retries, {
      webhookId: 'wh_abc',
      attempt: 3,
      status: 'delivered',
      error: null,
      ts: LATER,
    });

    expect(result).toHaveLength(3);
    expect(result[2].status).toBe('delivered');
  });

  it('preserves the input array reference when called with same args', () => {
    const a = logAttempt([], STUB_DELIVERED);
    const b = logAttempt([], STUB_DELIVERED);
    // Different calls produce different arrays even with same content
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('retryStats', () => {
  it('returns clean-slate stats for empty input', () => {
    const stats = retryStats([]);
    expect(stats).toEqual<RetryStats>({
      total: 0,
      delivered: 0,
      failed: 0,
      pctSuccess: 100.0,
    });
  });

  it('returns 100% for all delivered entries', () => {
    const stats = retryStats([
      STUB_DELIVERED,
      { ...STUB_DELIVERED, webhookId: 'wh_xyz', attempt: 1 },
    ]);

    expect(stats.total).toBe(2);
    expect(stats.delivered).toBe(2);
    expect(stats.failed).toBe(0);
    expect(stats.pctSuccess).toBe(100.0);
  });

  it('returns 0% for all failed entries', () => {
    const stats = retryStats([
      STUB_FAILED,
      { ...STUB_FAILED, attempt: 2 },
    ]);

    expect(stats.total).toBe(2);
    expect(stats.delivered).toBe(0);
    expect(stats.failed).toBe(2);
    expect(stats.pctSuccess).toBe(0.0);
  });

  it('returns correct percentages for mixed entries', () => {
    const stats = retryStats([
      STUB_DELIVERED,
      { ...STUB_DELIVERED, webhookId: 'wh_xyz' },
      STUB_FAILED,
    ]);

    // 2 delivered / 3 total = 66.6... → 66.7
    expect(stats.total).toBe(3);
    expect(stats.delivered).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.pctSuccess).toBe(66.7);
  });

  it('handles a single entry', () => {
    const stats = retryStats([STUB_DELIVERED]);

    expect(stats.total).toBe(1);
    expect(stats.delivered).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.pctSuccess).toBe(100.0);
  });

  it('rounds pctSuccess to one decimal', () => {
    // 1 delivered / 3 total = 33.33... → 33.3
    const stats = retryStats([
      STUB_DELIVERED,
      STUB_FAILED,
      { ...STUB_FAILED, attempt: 2 },
    ]);

    expect(stats.total).toBe(3);
    expect(stats.delivered).toBe(1);
    expect(stats.failed).toBe(2);
    expect(stats.pctSuccess).toBe(33.3);
  });

  it('does not mutate the input array', () => {
    const entries: RetryLogEntry[] = [STUB_DELIVERED, STUB_FAILED];
    const copy = [...entries];
    retryStats(entries);

    expect(entries).toEqual(copy);
  });

  it('accepts a frozen readonly array', () => {
    const entries: readonly RetryLogEntry[] = Object.freeze([
      STUB_DELIVERED,
      STUB_FAILED,
    ]);
    const stats = retryStats(entries);

    expect(stats.total).toBe(2);
    expect(stats.delivered).toBe(1);
    expect(stats.failed).toBe(1);
  });
});

describe('TypeScript contract', () => {
  it('RetryLogEntry is a valid structural type', () => {
    const entry: RetryLogEntry = {
      webhookId: 'wh_test',
      attempt: 1,
      status: 'delivered',
      error: null,
      ts: '2026-06-29T12:00:00.000Z',
    };
    expect(entry.webhookId).toBe('wh_test');
  });

  it('RetryLogEntry error can be a string', () => {
    const entry: RetryLogEntry = {
      webhookId: 'wh_test',
      attempt: 1,
      status: 'failed',
      error: 'CONNECTION_TIMEOUT',
      ts: '2026-06-29T12:00:00.000Z',
    };
    expect(entry.error).toBe('CONNECTION_TIMEOUT');
  });

  it('RetryStats shape is complete', () => {
    const stats: RetryStats = {
      total: 10,
      delivered: 7,
      failed: 3,
      pctSuccess: 70.0,
    };
    expect(stats.pctSuccess).toBe(70.0);
  });

  it('logAttempt returns RetryLogEntry[]', () => {
    const result: RetryLogEntry[] = logAttempt([], STUB_DELIVERED);
    expect(Array.isArray(result)).toBe(true);
  });

  it('retryStats accepts readonly RetryLogEntry[]', () => {
    const result: RetryStats = retryStats(
      Object.freeze([STUB_DELIVERED]),
    );
    expect(result.total).toBe(1);
  });
});
