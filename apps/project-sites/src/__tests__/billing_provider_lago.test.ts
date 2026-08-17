/**
 * @file billing_provider_lago.test.ts
 * @description Guards the canonical-ledger persist → Lago delivery ordering.
 *
 * `usage_events` (D1) is the canonical ProjectSites billing ledger; Lago is the
 * downstream metering + rating layer. If the ledger INSERT is dropped, we must
 * NOT deliver the event to Lago — otherwise Lago rates/invoices usage our own
 * ledger has no record of (`getUsageSummaryFromLedger` under-reports, and
 * `#markDelivered`'s `UPDATE … WHERE id=?` no-ops on a row that never landed).
 *
 * Root cause this pins: `dbInsert` NEVER throws (it returns `{ error }`), so the
 * old `try/catch` around it in `#persistToLedger` was dead — a real D1 failure
 * was swallowed and delivery proceeded on a phantom ledger entry. See
 * [[dbinsert-updated-at-lying-success]] + [[raw-dbexecute-insert-unguarded]].
 */

import { LagoProvider } from '../services/billing_provider_lago.js';
import type { Env } from '../types/env.js';
import type { UsageEvent } from '../services/billing_provider.js';

interface MockDb {
  db: D1Database;
  runs: string[];
}

/**
 * Minimal D1 stub. `insertError` (when set) makes the `usage_events` INSERT's
 * `.run()` throw — which `dbExecute` catches and surfaces as `{ error }` (D1
 * never bubbles the throw up to `dbInsert`'s caller). Every other statement
 * (incl. `#markDelivered`'s UPDATE) resolves cleanly.
 */
function makeDb(opts: { insertError?: string } = {}): MockDb {
  const runs: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(..._params: unknown[]) {
          return {
            async run() {
              runs.push(sql);
              if (/INSERT INTO usage_events/i.test(sql) && opts.insertError) {
                throw new Error(opts.insertError);
              }
              return { meta: { changes: 1 } };
            },
            async all() {
              return { results: [] as unknown[] };
            },
            async first() {
              return null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, runs };
}

function envWith(db: D1Database): Env {
  return {
    DB: db,
    LAGO_API_KEY: 'test-key',
    LAGO_API_URL: 'https://api.getlago.test/api/v1',
  } as unknown as Env;
}

function sampleEvent(over: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: 'evt-1',
    idempotencyKey: 'evt-1',
    customerId: 'cus_1',
    orgId: 'org_1',
    metric: 'ai_input_tokens',
    quantity: 1000,
    unit: 'token',
    source: 'ai_gateway',
    occurredAt: '2026-08-16T00:00:00.000Z',
    ...over,
  };
}

describe('LagoProvider — ledger persist gates Lago delivery (fail-closed)', () => {
  let fetchSpy: jest.Mock;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = jest.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('does NOT deliver to Lago when the canonical-ledger INSERT fails', async () => {
    const { db } = makeDb({ insertError: 'D1_ERROR: disk I/O error' });
    const provider = new LagoProvider(envWith(db));

    await provider.recordUsage(sampleEvent());

    // Fail-closed: a dropped ledger row must NOT be billed by Lago.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('delivers to Lago when the ledger INSERT succeeds', async () => {
    const { db } = makeDb({});
    const provider = new LagoProvider(envWith(db));

    await provider.recordUsage(sampleEvent());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain('/events');
  });

  it('treats a UNIQUE replay as already-persisted and still delivers (idempotent)', async () => {
    const { db } = makeDb({
      insertError: 'UNIQUE constraint failed: usage_events.idempotency_key',
    });
    const provider = new LagoProvider(envWith(db));

    await provider.recordUsage(sampleEvent());

    // The event is already in the canonical ledger; Lago dedups by transaction_id.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('recordUsageBatch delivers only the events whose ledger INSERT succeeded', async () => {
    // First event's INSERT fails, second succeeds. Only the second reaches Lago.
    const runs: string[] = [];
    let insertCount = 0;
    const db = {
      prepare(sql: string) {
        return {
          bind(..._params: unknown[]) {
            return {
              async run() {
                runs.push(sql);
                if (/INSERT INTO usage_events/i.test(sql)) {
                  insertCount += 1;
                  if (insertCount === 1) throw new Error('D1_ERROR: locked');
                }
                return { meta: { changes: 1 } };
              },
              async all() {
                return { results: [] as unknown[] };
              },
              async first() {
                return null;
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const provider = new LagoProvider(envWith(db));

    await provider.recordUsageBatch([
      sampleEvent({ id: 'a', idempotencyKey: 'a' }),
      sampleEvent({ id: 'b', idempotencyKey: 'b' }),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
