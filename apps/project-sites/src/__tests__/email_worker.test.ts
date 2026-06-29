/**
 * Unit tests for the email-queue job definitions
 * ({@link services/email_worker.ts}).
 *
 * Covers:
 *   - createEmailJob produces the correct envelope (id set, status queued,
 *     default maxAttempts)
 *   - shouldRetry returns true while attempts < maxAttempts, false at or past
 *     the limit
 *   - nextRetryDelay returns the correct exponential schedule at every index
 *     and clamps beyond the table
 *   - All functions are pure — no state leak between calls
 */

import {
  createEmailJob,
  DEFAULT_MAX_ATTEMPTS,
  nextRetryDelay,
  shouldRetry,
} from '../services/email_worker.js';

describe('createEmailJob', () => {
  it('produces a queued job with auto-generated id and default maxAttempts', () => {
    const job = createEmailJob('transactional', 'a@b.com', 'Welcome', '<p>hi</p>');

    expect(job.id).toBeDefined();
    expect(job.id.length).toBeGreaterThan(0);
    expect(job.type).toBe('transactional');
    expect(job.to).toBe('a@b.com');
    expect(job.subject).toBe('Welcome');
    expect(job.body).toBe('<p>hi</p>');
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(job.createdAt).toBeDefined();
    expect(() => new Date(job.createdAt)).not.toThrow();
  });

  it('uses UUID v4 for id', () => {
    const job = createEmailJob('campaign', 'b@c.com', 'Sale', 'body');

    expect(job.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('accepts every EmailJobType variant', () => {
    const types: Array<['transactional' | 'campaign' | 'digest' | 'invite']> = [
      ['transactional'],
      ['campaign'],
      ['digest'],
      ['invite'],
    ];
    for (const [type] of types) {
      const job = createEmailJob(type, 'x@y.z', 't', 'b');
      expect(job.type).toBe(type);
    }
  });

  it('generates unique ids on every call', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(createEmailJob('transactional', 'a@b.com', 's', 'b').id);
    }
    expect(ids.size).toBe(100);
  });
});

describe('shouldRetry', () => {
  it('returns true when attempts are below maxAttempts', () => {
    expect(shouldRetry({ attempts: 0, maxAttempts: 4 })).toBe(true);
    expect(shouldRetry({ attempts: 1, maxAttempts: 4 })).toBe(true);
    expect(shouldRetry({ attempts: 3, maxAttempts: 4 })).toBe(true);
  });

  it('returns false when attempts equal maxAttempts', () => {
    expect(shouldRetry({ attempts: 4, maxAttempts: 4 })).toBe(false);
  });

  it('returns false when attempts exceed maxAttempts', () => {
    expect(shouldRetry({ attempts: 5, maxAttempts: 4 })).toBe(false);
    expect(shouldRetry({ attempts: 10, maxAttempts: 4 })).toBe(false);
  });

  it('works with any maxAttempts value', () => {
    expect(shouldRetry({ attempts: 0, maxAttempts: 1 })).toBe(true);
    expect(shouldRetry({ attempts: 1, maxAttempts: 1 })).toBe(false);
    expect(shouldRetry({ attempts: 2, maxAttempts: 3 })).toBe(true);
    expect(shouldRetry({ attempts: 3, maxAttempts: 3 })).toBe(false);
  });
});

describe('nextRetryDelay', () => {
  it('returns 30s for the first retry (attempts=0)', () => {
    expect(nextRetryDelay(0)).toBe(30_000);
  });

  it('returns 2min for the second retry (attempts=1)', () => {
    expect(nextRetryDelay(1)).toBe(120_000);
  });

  it('returns 8min for the third retry (attempts=2)', () => {
    expect(nextRetryDelay(2)).toBe(480_000);
  });

  it('returns 10min for the fourth retry (attempts=3)', () => {
    expect(nextRetryDelay(3)).toBe(600_000);
  });

  it('clamps to the last entry for attempts beyond the table', () => {
    const last = nextRetryDelay(3);
    expect(nextRetryDelay(4)).toBe(last);
    expect(nextRetryDelay(10)).toBe(last);
    expect(nextRetryDelay(100)).toBe(last);
  });

  it('never returns a negative or zero value', () => {
    for (let i = 0; i <= 10; i++) {
      expect(nextRetryDelay(i)).toBeGreaterThan(0);
    }
  });
});

describe('DEFAULT_MAX_ATTEMPTS', () => {
  it('is 4', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(4);
  });
});
