/**
 * Event bus + outbox — CloudEvents envelope validity, idempotent writes,
 * DLQ-aware failure path. Stub D1 (no real binding), per the convergence
 * fake-provider-tested mandate.
 */
import {
  buildEvent,
  writeOutbox,
  readPendingOutbox,
  markDispatched,
  markFailed,
  eventIdempotencyKey,
  nextOutboxAction,
  MAX_OUTBOX_ATTEMPTS,
  ProjectSitesEventSchema,
  type BuildEventInput,
} from '../services/event_bus.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../types/env.js';

const baseInput: BuildEventInput = {
  type: 'site.claim.completed',
  producer: 'worker',
  tenantId: 't1',
  traceId: 'trace-abc',
  siteId: 'site-1',
  data: { siteId: 'site-1', plan: 'paid' },
};

/** Stub D1 that records every prepare/bind and returns a scripted result. */
function stubDb(runResult: { changes?: number } = { changes: 1 }, allRows: unknown[] = []) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const entry = { sql, binds: [] as unknown[] };
        calls.push(entry);
        return {
          bind(...args: unknown[]) {
            entry.binds = args;
            return {
              run: async () => ({ meta: { changes: runResult.changes ?? 0 } }),
              all: async () => ({ results: allRows }),
            };
          },
        };
      },
    },
  } as unknown as Pick<Env, 'DB'>;
  return { env, calls };
}

describe('buildEvent', () => {
  it('produces a valid CloudEvents 1.0 envelope (deterministic id/time)', () => {
    const ev = buildEvent(baseInput, 'evt-1', '2026-06-19T00:00:00.000Z');
    expect(ProjectSitesEventSchema.safeParse(ev).success).toBe(true);
    expect(ev).toMatchObject({
      specversion: '1.0',
      datacontenttype: 'application/json',
      id: 'evt-1',
      time: '2026-06-19T00:00:00.000Z',
      type: 'site.claim.completed',
      source: 'projectsites/worker',
      tenantId: 't1',
      siteId: 'site-1',
    });
  });

  it('rejects a missing tenantId (tenant-scoped invariant)', () => {
    expect(() =>
      buildEvent({ ...baseInput, tenantId: '' }, 'evt-2', '2026-06-19T00:00:00.000Z'),
    ).toThrow();
  });

  it('rejects an unknown event type', () => {
    expect(() =>
      buildEvent(
        { ...baseInput, type: 'bogus.event' as never },
        'evt-3',
        '2026-06-19T00:00:00.000Z',
      ),
    ).toThrow();
  });
});

describe('eventIdempotencyKey', () => {
  it('is deterministic + namespaced by type and scope', () => {
    expect(eventIdempotencyKey('invoice.paid', 'evt_123')).toBe('invoice.paid:evt_123');
    expect(eventIdempotencyKey('site.claim.completed', 'short-x', 'site-1')).toBe(
      'site.claim.completed:short-x:site-1',
    );
    // same logical transition → same key (the dedupe guarantee)
    expect(eventIdempotencyKey('invoice.paid', 'evt_123')).toBe(
      eventIdempotencyKey('invoice.paid', ' evt_123 '),
    );
  });

  it('throws when no scope is supplied (a keyless event cannot dedupe)', () => {
    expect(() => eventIdempotencyKey('invoice.paid')).toThrow(RangeError);
    expect(() => eventIdempotencyKey('invoice.paid', '  ')).toThrow(RangeError);
  });
});

describe('schema ↔ migration drift guard (0574_outbox_events.sql)', () => {
  const ddl = readFileSync(join(__dirname, '../../migrations/0574_outbox_events.sql'), 'utf8');

  // Every column event_bus.ts reads or writes MUST exist in the migration.
  const usedColumns = [
    'id',
    'idempotency_key',
    'type',
    'tenant_id',
    'site_id',
    'trace_id',
    'producer',
    'payload',
    'status',
    'attempts',
    'last_error',
    'created_at',
    'dispatched_at',
  ];

  it.each(usedColumns)('migration declares column %s', (col) => {
    expect(ddl).toMatch(new RegExp(`\\b${col}\\b`));
  });

  it('keeps the idempotency_key UNIQUE constraint (idempotent writes depend on it)', () => {
    expect(ddl).toMatch(/idempotency_key\s+TEXT\s+NOT NULL\s+UNIQUE/i);
  });
});

describe('nextOutboxAction — dispatcher dead-letter gate', () => {
  it('dispatches pending, skips dispatched', () => {
    expect(nextOutboxAction({ status: 'pending', attempts: 0 })).toBe('dispatch');
    expect(nextOutboxAction({ status: 'dispatched', attempts: 2 })).toBe('skip');
  });

  it('retries a failed row under the cap, dead-letters at/over it', () => {
    expect(nextOutboxAction({ status: 'failed', attempts: 1 })).toBe('retry');
    expect(nextOutboxAction({ status: 'failed', attempts: MAX_OUTBOX_ATTEMPTS - 1 })).toBe('retry');
    expect(nextOutboxAction({ status: 'failed', attempts: MAX_OUTBOX_ATTEMPTS })).toBe(
      'dead-letter',
    );
    expect(nextOutboxAction({ status: 'failed', attempts: 99 })).toBe('dead-letter');
  });

  it('honors a custom attempt cap', () => {
    expect(nextOutboxAction({ status: 'failed', attempts: 2 }, 2)).toBe('dead-letter');
    expect(nextOutboxAction({ status: 'failed', attempts: 1 }, 2)).toBe('retry');
  });
});

describe('writeOutbox — idempotent', () => {
  const ev = buildEvent(baseInput, 'evt-10', '2026-06-19T00:00:00.000Z');

  it('inserts via INSERT OR IGNORE keyed on the idempotency key', async () => {
    const { env, calls } = stubDb({ changes: 1 });
    const res = await writeOutbox(env, ev, 'idem-1');
    expect(res.inserted).toBe(true);
    expect(calls[0].sql).toMatch(/INSERT OR IGNORE INTO outbox_events/);
    expect(calls[0].binds[1]).toBe('idem-1'); // idempotency_key
    expect(calls[0].binds[3]).toBe('t1'); // tenant_id
  });

  it('reports inserted=false when the key already existed (changes=0)', async () => {
    const { env } = stubDb({ changes: 0 });
    const res = await writeOutbox(env, ev, 'idem-1');
    expect(res.inserted).toBe(false);
  });
});

describe('outbox drain + DLQ', () => {
  it('reads pending AND retryable-failed rows so failed events actually retry (not stranded)', async () => {
    const ev = buildEvent(baseInput, 'evt-20', '2026-06-19T00:00:00.000Z');
    const { env, calls } = stubDb({ changes: 0 }, [{ payload: JSON.stringify(ev) }]);
    const pending = await readPendingOutbox(env, 10);
    // The pending-only reader stranded failed events forever: drainOutbox only re-reads
    // this set, so a `markFailed` row (status='failed', attempts<MAX) was never picked up
    // → it never retried AND never dead-lettered (attempts stuck at 1). The reader MUST
    // also include retryable-failed rows so the retry→dead-letter lifecycle actually runs.
    expect(calls[0].sql).toMatch(/status = 'pending'/);
    expect(calls[0].sql).toMatch(/status = 'failed' AND attempts </);
    expect(calls[0].binds[0]).toBe(MAX_OUTBOX_ATTEMPTS);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('evt-20');
  });

  it('markDispatched flips status to dispatched', async () => {
    const { env, calls } = stubDb();
    await markDispatched(env, 'evt-20', '2026-06-19T01:00:00.000Z');
    expect(calls[0].sql).toMatch(/status = 'dispatched'/);
  });

  it('markFailed increments attempts + records last_error (DLQ signal)', async () => {
    const { env, calls } = stubDb();
    await markFailed(env, 'evt-20', 'queue publish timeout');
    expect(calls[0].sql).toMatch(/status = 'failed', attempts = attempts \+ 1/);
    expect(calls[0].binds[0]).toBe('queue publish timeout');
  });
});
