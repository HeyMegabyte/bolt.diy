import { emitEvent, tryEmitEvent } from '../services/emit_event';

/**
 * emitEvent — the one-call golden-path bus emit (buildEvent + key + writeOutbox).
 * writeOutbox uses env.DB.prepare directly, so a D1 stub (below) is all that's
 * needed — no db.js mock. Deterministic clock/id injected. No network.
 */
const base = {
  type: 'site.claim.started' as const,
  producer: 'worker' as const,
  tenantId: 't1',
  traceId: 'tr1',
  siteId: 's1',
  data: { shortlink: 'abc' },
};

/** D1 stub whose INSERT OR IGNORE reports a row change (or none for dup). */
function db(changes = 1) {
  const stmt = {
    _args: [] as unknown[],
    bind(...a: unknown[]) {
      this._args = a;
      return this;
    },
    async run() {
      return { meta: { changes } };
    },
  };
  return { prepare: () => stmt, _stmt: stmt } as never;
}

describe('emitEvent', () => {
  it('builds + writes the event, returns inserted:true', async () => {
    const env = { DB: db(1) };
    const r = await emitEvent(env as never, base, {
      now: () => '2026-06-19T00:00:00Z',
      id: () => 'evt_1',
    });
    expect(r.inserted).toBe(true);
    expect(r.event.id).toBe('evt_1');
    expect(r.event.time).toBe('2026-06-19T00:00:00Z');
    expect(r.event.type).toBe('site.claim.started');
    expect(r.event.tenantId).toBe('t1');
    expect(r.event.specversion).toBe('1.0');
  });

  it('reports inserted:false on a duplicate idempotency key (0 changes)', async () => {
    const env = { DB: db(0) };
    const r = await emitEvent(env as never, base, { id: () => 'e', now: () => 't' });
    expect(r.inserted).toBe(false);
  });

  it('derives the idempotency key from type + explicit scope', async () => {
    const env = db(1);
    // INSERT binds idempotency_key as the 2nd column → capture it.
    await emitEvent({ DB: env } as never, base, {
      scope: ['abc', 'started'],
      id: () => 'e',
      now: () => 't',
    });
    const boundKey = (env as unknown as { _stmt: { _args: unknown[] } })._stmt._args[1];
    expect(boundKey).toBe('site.claim.started:abc:started');
  });

  it('defaults scope to [siteId] when none given', async () => {
    const env = db(1);
    await emitEvent({ DB: env } as never, base, { id: () => 'e', now: () => 't' });
    const boundKey = (env as unknown as { _stmt: { _args: unknown[] } })._stmt._args[1];
    expect(boundKey).toBe('site.claim.started:s1');
  });
});

describe('tryEmitEvent', () => {
  it('returns the result on success', async () => {
    const r = await tryEmitEvent({ DB: db(1) } as never, base, { id: () => 'e', now: () => 't' });
    expect(r?.inserted).toBe(true);
  });

  it('returns null (never throws) when the write fails', async () => {
    const env = {
      DB: {
        prepare: () => ({
          bind: () => ({
            run: async () => {
              throw new Error('db down');
            },
          }),
        }),
      },
    };
    const r = await tryEmitEvent(env as never, base, { id: () => 'e', now: () => 't' });
    expect(r).toBeNull();
  });
});
