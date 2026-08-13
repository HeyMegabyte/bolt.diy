import { describe, it, expect } from '@jest/globals';

// D1-stub pattern — no jest.mock of db.js (@swc/jest's hoist doesn't reliably
// apply per-test overrides here; see _LOOP_LEDGER fire-v2.40+). A fake
// D1Database returns a queued `{results}` per `.all()` (dbQuery reads it and
// catches internally, so a queued Error simulates a D1 outage); dbExecute uses
// .run().
import { upsertVariants, listVariants, resolveVariant, FLAG_KEY } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

function makeDb(queue: Array<{ results: unknown[] } | Error> = []) {
  let i = 0;
  const stmt = {
    bind: () => stmt,
    all: async () => {
      const entry = queue[i++];
      if (entry instanceof Error) throw entry;
      return entry ?? { results: [] };
    },
    run: async () => ({ meta: { changes: 1 } }),
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

function envWith(db: D1Database): Env {
  return { DB: db } as unknown as Env;
}

describe('edge_personalization', () => {
  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('edge_personalization');
  });

  it('upsertVariants() calls dbExecute for each variant', async () => {
    const count = await upsertVariants(envWith(makeDb()), 'site1', [
      { id: 'v1', name: 'Mobile', conditions: { device: 'mobile' }, priority: 10 },
    ]);
    expect(count).toBe(1);
  });

  it('listVariants() parses conditions JSON and returns priority-ordered rules', async () => {
    const env = envWith(
      makeDb([
        {
          results: [
            { id: 'v1', name: 'VIP', conditions: '{"isReturn":true}', priority: 40 },
            { id: 'v2', name: 'Mobile', conditions: '{"device":"mobile"}', priority: 30 },
          ],
        },
      ]),
    );
    const rules = await listVariants(env, 'site1');
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({ id: 'v1', name: 'VIP', conditions: { isReturn: true }, priority: 40 });
    expect(rules[1].conditions).toEqual({ device: 'mobile' });
  });

  it('listVariants() returns [] on DB error (missing table degrades soft)', async () => {
    const rules = await listVariants(envWith(makeDb([new Error('no such table')])), 'site1');
    expect(rules).toEqual([]);
  });

  it('resolveVariant() returns default when no variants match', async () => {
    const result = await resolveVariant(envWith(makeDb([{ results: [] }])), 'site1', {
      device: 'desktop',
    });
    expect(result.variantId).toBe('default');
  });

  it('resolveVariant() matches mobile device condition', async () => {
    const env = envWith(
      makeDb([
        {
          results: [{ id: 'v1', name: 'Mobile', conditions: '{"device":"mobile"}', priority: 10 }],
        },
      ]),
    );
    const result = await resolveVariant(env, 'site1', { device: 'mobile' });
    expect(result.variantId).toBe('v1');
    expect(result.variantName).toBe('Mobile');
  });

  it('resolveVariant() returns default on DB error', async () => {
    const result = await resolveVariant(envWith(makeDb([new Error('DB down')])), 'site1', {});
    expect(result.variantId).toBe('default');
  });
});
