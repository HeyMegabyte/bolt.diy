import {
  eventDispatchTargets,
  dispatchOutboxEvent,
  drainOutbox,
  assessDrainHealth,
  OUTBOX_TINYBIRD_DATASOURCE,
} from '../services/outbox_dispatch';
import type { ProjectSitesEvent } from '../services/event_bus';

/**
 * Outbox dispatch router — fans event_bus events to Tinybird (all)
 * + Hatchet (orchestration types). Pure router + DI'd adapters; D1 stubbed for
 * the drain. No real network/DB.
 */
function ev(type: string, over: Partial<ProjectSitesEvent> = {}): ProjectSitesEvent {
  return {
    id: 'evt_1',
    type,
    tenantId: 't1',
    siteId: 's1',
    traceId: 'tr1',
    producer: 'worker',
    time: '2026-06-19T00:00:00Z',
    specversion: '1.0',
    schemaVersion: '1',
    source: 'worker',
    datacontenttype: 'application/json',
    data: {},
    ...over,
  } as ProjectSitesEvent;
}
const ENV = { TINYBIRD_API_HOST: 'https://api.x.tinybird.co', TINYBIRD_PASSWORD: 'p.tok' } as never;

describe('eventDispatchTargets', () => {
  it('routes EVERY event to Tinybird', () => {
    expect(eventDispatchTargets(ev('site.created'))).toContain('tinybird');
    expect(eventDispatchTargets(ev('site.published'))).toContain('tinybird');
  });
  // Routing table per src/services/outbox_dispatch.ts:
  // baseline = ['tinybird'] for EVERY event (analytics), with 'hatchet'
  // appended for orchestration types only.
  it('adds Hatchet for orchestration types', () => {
    expect(eventDispatchTargets(ev('site.published'))).toEqual(['tinybird', 'hatchet']);
    expect(eventDispatchTargets(ev('invoice.paid'))).toEqual(['tinybird', 'hatchet']);
  });
  it('does NOT route pure-analytics types to Hatchet', () => {
    expect(eventDispatchTargets(ev('site.created'))).toEqual(['tinybird']);
  });
});

describe('dispatchOutboxEvent', () => {
  it('skips an unconfigured backend (not a failure) → ok with no attempts', async () => {
    const r = await dispatchOutboxEvent({} as never, ev('site.published'));
    expect(r.ok).toBe(true);
    expect(r.attempted).toEqual([]);
  });

  it('sends an analytics event to Tinybird only, tenant-tagged', async () => {
    const ingest = jest.fn().mockResolvedValue({ ok: true, status: 202 });
    const push = jest.fn();
    const r = await dispatchOutboxEvent(ENV, ev('site.created'), {
      ingestTinybird: ingest as never,
      pushHatchet: push as never,
    });
    expect(r.ok).toBe(true);
    expect(r.attempted).toEqual(['tinybird']);
    expect(push).not.toHaveBeenCalled();
    const [, ds, row] = ingest.mock.calls[0];
    expect(ds).toBe(OUTBOX_TINYBIRD_DATASOURCE);
    expect(row.tenant_id).toBe('t1');
    expect(row.event).toBe('site.created');
    expect(row.event_id).toBe('evt_1');
  });

  it('carries the event data as a JSON `payload` string (high-cardinality signal)', async () => {
    const ingest = jest.fn().mockResolvedValue({ ok: true, status: 202 });
    const data = { slug: 'acme', version: 'v1', source: 'bolt-embedded' };
    await dispatchOutboxEvent(ENV, ev('site.published', { data }), {
      ingestTinybird: ingest as never,
      pushHatchet: jest.fn().mockResolvedValue({ ok: true }) as never,
    });
    const row = ingest.mock.calls[0][2];
    expect(typeof row.payload).toBe('string');
    expect(JSON.parse(row.payload)).toEqual(data);
  });

  it('defaults payload to "{}" when the event carries no data', async () => {
    const ingest = jest.fn().mockResolvedValue({ ok: true });
    await dispatchOutboxEvent(ENV, ev('site.created'), { ingestTinybird: ingest as never });
    expect(ingest.mock.calls[0][2].payload).toBe('{}');
  });

  it('fans an orchestration event to BOTH backends', async () => {
    const ingest = jest.fn().mockResolvedValue({ ok: true });
    const push = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const env = { ...(ENV as object), HATCHET_API_TOKEN: hatchetTok() } as never;
    const r = await dispatchOutboxEvent(env, ev('site.published'), {
      ingestTinybird: ingest as never,
      pushHatchet: push as never,
    });
    expect(r.ok).toBe(true);
    expect(r.attempted).toEqual(['tinybird', 'hatchet']);
    expect(push).toHaveBeenCalled();
    const [, key, , opts] = push.mock.calls[0];
    expect(key).toBe('site.published');
    expect(opts.metadata.tenant_id).toBe('t1');
    expect(opts.metadata.site_id).toBe('s1');
  });

  it('reports a configured-backend rejection as not-ok (row will retry)', async () => {
    const ingest = jest.fn().mockResolvedValue({ ok: false, reason: 'http_error' });
    const r = await dispatchOutboxEvent(ENV, ev('site.created'), {
      ingestTinybird: ingest as never,
    });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toEqual({ target: 'tinybird', reason: 'http_error' });
  });
});

describe('drainOutbox', () => {
  /** D1 stub: SELECT pending → rows; UPDATEs are recorded. */
  function db(rows: ProjectSitesEvent[]) {
    const updates: string[] = [];
    const stmt = {
      bind: (...a: unknown[]) => {
        stmt._args = a;
        return stmt;
      },
      _args: [] as unknown[],
      all: async () => ({ results: rows.map((r) => ({ payload: JSON.stringify(r) })) }),
      run: async () => {
        updates.push(String(stmt._args[0]));
        return { meta: { changes: 1 } };
      },
      first: async () => null,
    };
    return { db: { prepare: () => stmt } as never, updates };
  }

  it('dispatches pending rows + marks them dispatched', async () => {
    const { db: DB, updates } = db([ev('site.created', { id: 'e1' })]);
    const env = { ...(ENV as object), DB } as never;
    const summary = await drainOutbox(env, {
      ingestTinybird: (async () => ({ ok: true })) as never,
      now: () => 'NOW',
    });
    expect(summary.read).toBe(1);
    expect(summary.dispatched).toBe(1);
    expect(summary.failed).toBe(0);
    expect(updates).toContain('NOW'); // markDispatched bound dispatched_at first
  });

  it('marks a row failed when its configured backend rejects', async () => {
    const { db: DB } = db([ev('site.created', { id: 'e1' })]);
    const env = { ...(ENV as object), DB } as never;
    const summary = await drainOutbox(env, {
      ingestTinybird: (async () => ({ ok: false, reason: 'http_error' })) as never,
    });
    expect(summary.failed).toBe(1);
    expect(summary.dispatched).toBe(0);
  });

  it('returns zeros (never throws) when the read fails', async () => {
    const env = {
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => {
              throw new Error('db down');
            },
          }),
        }),
      },
    } as never;
    expect(await drainOutbox(env)).toEqual({ read: 0, dispatched: 0, failed: 0 });
  });
});

describe('assessDrainHealth', () => {
  it('is info for a clean drain (no failures, under capacity)', () => {
    const h = assessDrainHealth({ read: 3, dispatched: 3, failed: 0 });
    expect(h).toEqual({
      level: 'info',
      hasFailures: false,
      atCapacity: false,
      message: 'Outbox drained cleanly (3 dispatched)',
    });
  });

  it('is info for an empty drain', () => {
    expect(assessDrainHealth({ read: 0, dispatched: 0, failed: 0 }).level).toBe('info');
  });

  it('warns when events failed dispatch (heading to the dead-letter gate)', () => {
    const h = assessDrainHealth({ read: 5, dispatched: 3, failed: 2 });
    expect(h.level).toBe('warn');
    expect(h.hasFailures).toBe(true);
    expect(h.message).toContain('2 event(s) failed');
  });

  it('warns when the page is full (outbox may be backing up)', () => {
    const h = assessDrainHealth({ read: 50, dispatched: 50, failed: 0 }, 50);
    expect(h.level).toBe('warn');
    expect(h.atCapacity).toBe(true);
    expect(h.message).toContain('backing up');
  });

  it('honors a custom limit for the capacity check', () => {
    expect(assessDrainHealth({ read: 10, dispatched: 10, failed: 0 }, 10).atCapacity).toBe(true);
    expect(assessDrainHealth({ read: 9, dispatched: 9, failed: 0 }, 10).atCapacity).toBe(false);
  });

  it('reports both signals when failures AND capacity coincide', () => {
    const h = assessDrainHealth({ read: 50, dispatched: 40, failed: 10 }, 50);
    expect(h.level).toBe('warn');
    expect(h.message).toContain('failed');
    expect(h.message).toContain('backing up');
  });
});

/** A minimal Hatchet JWT (server_url + sub) so resolveHatchet returns config. */
function hatchetTok(): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${b64({})}.${b64({ server_url: 'https://h.run', sub: 'tn' })}.s`;
}
