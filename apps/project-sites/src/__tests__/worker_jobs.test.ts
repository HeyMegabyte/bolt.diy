/**
 * Unit coverage for services/worker_jobs — pure factory + key helpers.
 *
 * Covers: createJob with all namespaces, default priority fill, explicit
 * priority override, default timeout/retries per namespace, required fields
 * present, jobKey format, DEFAULT_TIMEOUTS immutability, and the
 * Record<string,unknown> payload passthrough.
 */

import { createJob, jobKey, DEFAULT_TIMEOUTS } from '../services/worker_jobs.js';
import type { JobNamespace, JobDefinition } from '../services/worker_jobs.js';

describe('DEFAULT_TIMEOUTS', () => {
  it('returns expected ms for every namespace', () => {
    expect(DEFAULT_TIMEOUTS).toEqual({
      email: 30_000,
      build: 300_000,
      analytics: 60_000,
      social: 60_000,
      cleanup: 120_000,
    });
  });

  it('is frozen and cannot be mutated', () => {
    expect(() => {
      (DEFAULT_TIMEOUTS as Record<string, number>).email = 0;
    }).toThrow();
  });
});

describe('createJob', () => {
  it.each(['email', 'build', 'analytics', 'social', 'cleanup'] as JobNamespace[])(
    'creates a job for namespace %s with correct defaults',
    (ns) => {
      const job = createJob(ns, 'test-job', { foo: 'bar' });
      expect(job.namespace).toBe(ns);
      expect(job.name).toBe('test-job');
      expect(job.payload).toEqual({ foo: 'bar' });
      expect(job.priority).toBe(2);
      expect(job.maxRetries).toBeGreaterThanOrEqual(1);
      expect(job.timeoutMs).toBe(DEFAULT_TIMEOUTS[ns]);
    },
  );

  it('uses provided priority', () => {
    const job = createJob('email', 'urgent', { x: 1 }, 1);
    expect(job.priority).toBe(1);
  });

  it('uses priority 3 when provided', () => {
    const job = createJob('cleanup', 'old-logs', {}, 3);
    expect(job.priority).toBe(3);
  });

  it('passes through any JSON-serialisable payload', () => {
    const payload = { a: 1, b: 'two', c: null, d: [1, 2, 3] };
    const job = createJob('analytics', 'pageview', payload);
    expect(job.payload).toEqual(payload);
  });

  it('returns correct maxRetries for each namespace', () => {
    expect(createJob('email', 'x', {}).maxRetries).toBe(3);
    expect(createJob('build', 'x', {}).maxRetries).toBe(2);
    expect(createJob('analytics', 'x', {}).maxRetries).toBe(1);
    expect(createJob('social', 'x', {}).maxRetries).toBe(3);
    expect(createJob('cleanup', 'x', {}).maxRetries).toBe(2);
  });

  it('handles empty payload', () => {
    const job = createJob('build', 'empty-test', {});
    expect(job.payload).toEqual({});
  });
});

describe('jobKey', () => {
  it('returns "namespace:name" format', () => {
    const job = createJob('email', 'welcome', {});
    expect(jobKey(job)).toBe('email:welcome');
  });

  it('produces unique keys for same name under different namespaces', () => {
    const a = createJob('email', 'digest', {});
    const b = createJob('analytics', 'digest', {});
    expect(jobKey(a)).toBe('email:digest');
    expect(jobKey(b)).toBe('analytics:digest');
    expect(jobKey(a)).not.toBe(jobKey(b));
  });

  it('produces the same key for same ns:name regardless of payload', () => {
    const a = createJob('social', 'post', { text: 'hello' });
    const b = createJob('social', 'post', { text: 'world' });
    expect(jobKey(a)).toBe(jobKey(b));
  });
});
