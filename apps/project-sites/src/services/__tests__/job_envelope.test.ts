import { deadLetterJob, retryBackoffMs, retryJob, wrapJob } from '../job_envelope';

const JOB_ID = '019307f0-5c6e-7a1b-8000-abc123def456';
const IDEM_KEY = 'email.send:019307f0-abc:001';
const NOW_MS = 1719705600000;

describe('wrapJob', () => {
  it('wraps a payload in the canonical envelope', () => {
    const job = wrapJob(JOB_ID, 'email.send', IDEM_KEY, { to: 'a@b.com' }, NOW_MS);
    expect(job.jobId).toBe(JOB_ID);
    expect(job.jobType).toBe('email.send');
    expect(job.idempotencyKey).toBe(IDEM_KEY);
    expect(job.attempt).toBe(0);
    expect(job.maxAttempts).toBe(3);
    expect(job.createdAtMs).toBe(NOW_MS);
    expect(job.payload).toEqual({ to: 'a@b.com' });
  });

  it('accepts traceId and tenantId', () => {
    const job = wrapJob(JOB_ID, 'site.publish', IDEM_KEY, null, NOW_MS, {
      traceId: 'trace-123',
      tenantId: 'org-456',
    });
    expect(job.traceId).toBe('trace-123');
    expect(job.tenantId).toBe('org-456');
  });

  it('accepts custom maxAttempts', () => {
    const job = wrapJob(JOB_ID, 'ai.generate', IDEM_KEY, {}, NOW_MS, { maxAttempts: 5 });
    expect(job.maxAttempts).toBe(5);
  });
});

describe('retryJob', () => {
  it('increments attempt on first retry', () => {
    const job = wrapJob(JOB_ID, 'email.send', IDEM_KEY, null, NOW_MS);
    const retry = retryJob(job);
    expect(retry).not.toBeNull();
    expect(retry!.attempt).toBe(1);
    expect(retry!.jobId).toBe(JOB_ID);
  });

  it('returns null when maxAttempts exceeded', () => {
    const job = wrapJob(JOB_ID, 'email.send', IDEM_KEY, null, NOW_MS, { maxAttempts: 2 });
    const r1 = retryJob(job); // attempt 0→1
    expect(r1).not.toBeNull();
    const r2 = retryJob(r1!); // attempt 1→2 (>= maxAttempts 2) → null
    expect(r2).toBeNull();
  });

  it('returns null on first retry when maxAttempts is 1', () => {
    const job = wrapJob(JOB_ID, 'x', IDEM_KEY, null, NOW_MS, { maxAttempts: 1 });
    expect(retryJob(job)).toBeNull();
  });
});

describe('deadLetterJob', () => {
  it('stamps DLQ metadata', () => {
    const job = wrapJob(JOB_ID, 'email.send', IDEM_KEY, null, NOW_MS, { maxAttempts: 2 });
    const exhausted = { ...job, attempt: 2 };
    const dlq = deadLetterJob(exhausted, 'Connection refused after 2 retries', NOW_MS + 60000);
    expect(dlq.metadata.dlq_status).toBe('dead_lettered');
    expect(dlq.metadata.dlq_reason).toContain('Connection refused');
    expect(dlq.metadata.dlq_at_ms).toBe(String(NOW_MS + 60000));
  });

  it('truncates long reasons to 500 chars', () => {
    const job = wrapJob(JOB_ID, 'x', IDEM_KEY, null, NOW_MS);
    const longReason = 'x'.repeat(600);
    const dlq = deadLetterJob(job, longReason, NOW_MS);
    expect(dlq.metadata.dlq_reason.length).toBeLessThanOrEqual(500);
  });
});

describe('retryBackoffMs', () => {
  it('returns 1000 for attempt 0', () => {
    expect(retryBackoffMs(0)).toBe(1000);
  });

  it('returns 2000 for attempt 1', () => {
    expect(retryBackoffMs(1)).toBe(2000);
  });

  it('returns 4000 for attempt 2', () => {
    expect(retryBackoffMs(2)).toBe(4000);
  });

  it('returns 8000 for attempt 3', () => {
    expect(retryBackoffMs(3)).toBe(8000);
  });

  it('caps at 60000ms', () => {
    expect(retryBackoffMs(6)).toBe(60000);
    expect(retryBackoffMs(10)).toBe(60000);
  });

  it('returns 1000 for negative attempt (guards)', () => {
    expect(retryBackoffMs(-1)).toBe(1000);
  });
});
