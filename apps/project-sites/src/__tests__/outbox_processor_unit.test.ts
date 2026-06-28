import {
  processOutbox,
  nextStatusAfterFailure,
  OutboxProcessorError,
  type OutboxEventRow,
  type OutboxProcessorDb,
} from '../services/outbox_processor';
import { MAX_OUTBOX_ATTEMPTS } from '../services/event_bus';

/**
 * Pure outbox drain — DI'd `deliver`, D1 stubbed in-memory. No real network/DB.
 * Asserts the full state machine: deliver→dispatched, throw→retry, cap→dead,
 * empty pass, idempotent re-run, batch limit.
 */

interface StubRow {
  id: string;
  type: string;
  tenant_id: string;
  site_id: string | null;
  trace_id: string;
  producer: string;
  payload: string;
  status: 'pending' | 'dispatched' | 'failed';
  attempts: number;
  last_error: string | null;
  dispatched_at: string | null;
  created_at: string;
}

function row(over: Partial<StubRow> = {}): StubRow {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 8)}`,
    type: 'site.created',
    tenant_id: 't1',
    site_id: 's1',
    trace_id: 'tr1',
    producer: 'worker',
    payload: '{}',
    status: 'pending',
    attempts: 0,
    last_error: null,
    dispatched_at: null,
    created_at: '2026-06-20T00:00:00Z',
    ...over,
  };
}

/**
 * Minimal D1 stub recognizing exactly the three statements processOutbox issues:
 * the SELECT of undelivered rows, the dispatched UPDATE, and the failed UPDATE.
 */
function makeDb(store: StubRow[]): OutboxProcessorDb {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> {
              // SELECT ... WHERE pending OR (failed AND attempts < ?) ORDER BY created_at LIMIT ?
              const [maxAttempts, limit] = params as [number, number];
              const eligible = store
                .filter(
                  (r) =>
                    r.status === 'pending' ||
                    (r.status === 'failed' && r.attempts < maxAttempts),
                )
                .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
                .slice(0, limit)
                .map((r) => ({
                  id: r.id,
                  type: r.type,
                  tenant_id: r.tenant_id,
                  site_id: r.site_id,
                  trace_id: r.trace_id,
                  producer: r.producer,
                  payload: r.payload,
                  attempts: r.attempts,
                })) as unknown as T[];
              return { results: eligible };
            },
            async run(): Promise<unknown> {
              if (sql.includes("status = 'dispatched'")) {
                const [dispatchedAt, id] = params as [string, string];
                const r = store.find((x) => x.id === id);
                if (r) {
                  r.status = 'dispatched';
                  r.dispatched_at = dispatchedAt;
                }
              } else if (sql.includes("status = 'failed'")) {
                const [attempts, lastError, id] = params as [number, string, string];
                const r = store.find((x) => x.id === id);
                if (r) {
                  r.status = 'failed';
                  r.attempts = attempts;
                  r.last_error = lastError;
                }
              }
              return {};
            },
          };
        },
      };
    },
  };
}

describe('nextStatusAfterFailure (pure dead-letter gate)', () => {
  it('stays retryable below the cap', () => {
    expect(nextStatusAfterFailure(1)).toBe('failed');
    expect(nextStatusAfterFailure(MAX_OUTBOX_ATTEMPTS - 1)).toBe('failed');
  });
  it('dead-letters at/over the cap', () => {
    expect(nextStatusAfterFailure(MAX_OUTBOX_ATTEMPTS)).toBe('dead');
    expect(nextStatusAfterFailure(MAX_OUTBOX_ATTEMPTS + 1)).toBe('dead');
  });
  it('honors a custom cap', () => {
    expect(nextStatusAfterFailure(2, 3)).toBe('failed');
    expect(nextStatusAfterFailure(3, 3)).toBe('dead');
  });
});

describe('processOutbox', () => {
  it('throws OutboxProcessorError when db is missing', async () => {
    await expect(processOutbox(undefined as never, async () => {})).rejects.toBeInstanceOf(
      OutboxProcessorError,
    );
  });

  it('empty table → {processed:0, delivered:0, failed:0, dead:0}', async () => {
    const db = makeDb([]);
    const deliver = jest.fn();
    const s = await processOutbox(db, deliver as never);
    expect(s).toEqual({ processed: 0, delivered: 0, failed: 0, dead: 0 });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('delivers pending rows and marks them dispatched', async () => {
    const store = [row({ id: 'a', created_at: '2026-06-20T00:00:01Z' }), row({ id: 'b', created_at: '2026-06-20T00:00:02Z' })];
    const db = makeDb(store);
    const deliver = jest.fn().mockResolvedValue(undefined);

    const s = await processOutbox(db, deliver as never);

    expect(s).toEqual({ processed: 2, delivered: 2, failed: 0, dead: 0 });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(store.every((r) => r.status === 'dispatched')).toBe(true);
    expect(store.every((r) => r.dispatched_at !== null)).toBe(true);
  });

  it('delivers oldest-first (FIFO by created_at)', async () => {
    const store = [
      row({ id: 'new', created_at: '2026-06-20T00:00:09Z' }),
      row({ id: 'old', created_at: '2026-06-20T00:00:01Z' }),
    ];
    const seen: string[] = [];
    const db = makeDb(store);
    await processOutbox(db, async (e: OutboxEventRow) => {
      seen.push(e.id);
    });
    expect(seen).toEqual(['old', 'new']);
  });

  it('a throwing deliver increments attempts + keeps the row retryable', async () => {
    const store = [row({ id: 'x', attempts: 0 })];
    const db = makeDb(store);
    const deliver = jest.fn().mockRejectedValue(new Error('sink down'));

    const s = await processOutbox(db, deliver as never);

    expect(s).toEqual({ processed: 1, delivered: 0, failed: 1, dead: 0 });
    expect(store[0].status).toBe('failed');
    expect(store[0].attempts).toBe(1);
    expect(store[0].last_error).toBe('sink down');
    expect(store[0].dispatched_at).toBeNull();
  });

  it('failed row under cap is re-picked on the next run (retry)', async () => {
    const store = [row({ id: 'x', status: 'failed', attempts: 1 })];
    const db = makeDb(store);
    const deliver = jest.fn().mockResolvedValueOnce(undefined);

    const s = await processOutbox(db, deliver as never);

    expect(s.processed).toBe(1);
    expect(s.delivered).toBe(1);
    expect(store[0].status).toBe('dispatched');
  });

  it('reaching maxAttempts marks the row dead', async () => {
    // attempts = cap - 1; one more failure pushes it to the cap → dead.
    const store = [row({ id: 'x', status: 'failed', attempts: MAX_OUTBOX_ATTEMPTS - 1 })];
    const db = makeDb(store);
    const deliver = jest.fn().mockRejectedValue(new Error('still down'));

    const s = await processOutbox(db, deliver as never);

    expect(s).toEqual({ processed: 1, delivered: 0, failed: 0, dead: 1 });
    expect(store[0].attempts).toBe(MAX_OUTBOX_ATTEMPTS);
    expect(store[0].status).toBe('failed'); // failed-at-cap == dead-letter
  });

  it('does NOT re-pick dead-lettered rows (attempts >= cap)', async () => {
    const store = [row({ id: 'dead', status: 'failed', attempts: MAX_OUTBOX_ATTEMPTS })];
    const db = makeDb(store);
    const deliver = jest.fn();

    const s = await processOutbox(db, deliver as never);

    expect(s).toEqual({ processed: 0, delivered: 0, failed: 0, dead: 0 });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('re-run does not re-deliver already-dispatched rows (idempotent)', async () => {
    const store = [row({ id: 'a' }), row({ id: 'b' })];
    const db = makeDb(store);
    const deliver = jest.fn().mockResolvedValue(undefined);

    await processOutbox(db, deliver as never); // delivers both
    const s2 = await processOutbox(db, deliver as never); // nothing left

    expect(deliver).toHaveBeenCalledTimes(2); // not 4
    expect(s2).toEqual({ processed: 0, delivered: 0, failed: 0, dead: 0 });
  });

  it('respects the batch limit (oldest first)', async () => {
    const store = Array.from({ length: 5 }, (_, i) =>
      row({ id: `e${i}`, created_at: `2026-06-20T00:00:0${i}Z` }),
    );
    const db = makeDb(store);
    const deliver = jest.fn().mockResolvedValue(undefined);

    const s = await processOutbox(db, deliver as never, { limit: 2 });

    expect(s.processed).toBe(2);
    expect(s.delivered).toBe(2);
    expect(deliver).toHaveBeenCalledTimes(2);
    // The two OLDEST were taken; three remain undelivered.
    expect(store.filter((r) => r.status === 'pending')).toHaveLength(3);
    expect(store.filter((r) => r.status === 'dispatched').map((r) => r.id)).toEqual(['e0', 'e1']);
  });

  it('one bad event does not abort the pass (mixed batch)', async () => {
    const store = [
      row({ id: 'ok1', created_at: '2026-06-20T00:00:01Z' }),
      row({ id: 'bad', created_at: '2026-06-20T00:00:02Z' }),
      row({ id: 'ok2', created_at: '2026-06-20T00:00:03Z' }),
    ];
    const db = makeDb(store);
    const deliver = jest.fn(async (e: OutboxEventRow) => {
      if (e.id === 'bad') throw new Error('boom');
    });

    const s = await processOutbox(db, deliver as never);

    expect(s).toEqual({ processed: 3, delivered: 2, failed: 1, dead: 0 });
    expect(store.find((r) => r.id === 'ok1')!.status).toBe('dispatched');
    expect(store.find((r) => r.id === 'ok2')!.status).toBe('dispatched');
    expect(store.find((r) => r.id === 'bad')!.status).toBe('failed');
  });
});
