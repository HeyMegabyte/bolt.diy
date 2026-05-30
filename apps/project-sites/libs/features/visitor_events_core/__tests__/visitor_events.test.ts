/**
 * Unit tests for Visitor Events Core.
 * Covers: recordVisitorEvent insert, traffic rollup (pageviews / unique
 * sessions / conversions / topPaths / byType), and degrade-to-0 on table error.
 */

import { recordVisitorEvent, getTrafficSummary, FLAG_KEY } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

interface Ev {
  id: string;
  org_id: string;
  site_id: string;
  session_id: string;
  event_type: string;
  path: string | null;
  referrer: string | null;
  metadata: string;
}

function makeEnv(opts: { throwAll?: boolean } = {}): { env: Env; events: Ev[] } {
  const events: Ev[] = [];
  function prepare(sql: string) {
    let bound: unknown[] = [];
    const api = {
      bind: (...p: unknown[]) => {
        bound = p;
        return api;
      },
      run: async () => {
        if (sql.includes('INSERT INTO visitor_events')) {
          const [id, org_id, site_id, session_id, event_type, path, referrer, metadata] =
            bound as string[];
          events.push({
            id,
            org_id,
            site_id,
            session_id,
            event_type,
            path: path ?? null,
            referrer: referrer ?? null,
            metadata,
          });
        }
        return { meta: { changes: 1 } };
      },
      all: async <T>(): Promise<{ results: T[] }> => {
        if (opts.throwAll) throw new Error('no such table: visitor_events');
        const site = bound[0] as string;
        const rows = events.filter((e) => e.site_id === site);
        if (sql.includes('GROUP BY path')) {
          const m = new Map<string, number>();
          rows
            .filter((e) => e.event_type === 'pageview' && e.path)
            .forEach((e) => m.set(e.path!, (m.get(e.path!) ?? 0) + 1));
          return { results: [...m].map(([path, n]) => ({ path, n })) as unknown as T[] };
        }
        if (sql.includes('GROUP BY event_type')) {
          const m = new Map<string, number>();
          rows.forEach((e) => m.set(e.event_type, (m.get(e.event_type) ?? 0) + 1));
          return {
            results: [...m].map(([event_type, n]) => ({ event_type, n })) as unknown as T[],
          };
        }
        if (sql.includes('COUNT(DISTINCT session_id)')) {
          return {
            results: [{ n: new Set(rows.map((e) => e.session_id)).size }] as unknown as T[],
          };
        }
        if (sql.includes("event_type = 'conversion'")) {
          return {
            results: [
              { n: rows.filter((e) => e.event_type === 'conversion').length },
            ] as unknown as T[],
          };
        }
        if (sql.includes("event_type = 'pageview'")) {
          return {
            results: [
              { n: rows.filter((e) => e.event_type === 'pageview').length },
            ] as unknown as T[],
          };
        }
        return { results: [{ n: 0 }] as unknown as T[] };
      },
    };
    return api;
  }
  return { env: { DB: { prepare } as unknown as D1Database } as unknown as Env, events };
}

describe('visitor_events_core service', () => {
  it('exposes the flag key', () => {
    expect(FLAG_KEY).toBe('visitor_events_core');
  });

  it('records an event and rolls up traffic', async () => {
    const { env } = makeEnv();
    const ctx = { orgId: 'org1', siteId: 'site1' };
    await recordVisitorEvent(env, ctx, {
      sessionId: 'sess-aaaa1111',
      eventType: 'pageview',
      path: '/',
    });
    await recordVisitorEvent(env, ctx, {
      sessionId: 'sess-aaaa1111',
      eventType: 'pageview',
      path: '/pricing',
    });
    await recordVisitorEvent(env, ctx, {
      sessionId: 'sess-bbbb2222',
      eventType: 'pageview',
      path: '/',
    });
    await recordVisitorEvent(env, ctx, {
      sessionId: 'sess-bbbb2222',
      eventType: 'conversion',
      path: '/thanks',
    });

    const s = await getTrafficSummary(env, 'site1', 30);
    expect(s.pageviews).toBe(3);
    expect(s.uniqueSessions).toBe(2);
    expect(s.conversions).toBe(1);
    expect(s.topPaths).toEqual(
      expect.arrayContaining([
        { path: '/', count: 2 },
        { path: '/pricing', count: 1 },
      ]),
    );
    expect(s.byType).toEqual(
      expect.arrayContaining([
        { type: 'pageview', count: 3 },
        { type: 'conversion', count: 1 },
      ]),
    );
  });

  it('rejects an event with too-short sessionId', async () => {
    const { env } = makeEnv();
    await expect(
      recordVisitorEvent(env, { orgId: 'o', siteId: 's' }, {
        sessionId: 'x',
        eventType: 'pageview',
      } as never),
    ).rejects.toThrow();
  });

  it('degrades to an all-zero summary when the table errors', async () => {
    const { env } = makeEnv({ throwAll: true });
    const s = await getTrafficSummary(env, 'site1', 30);
    expect(s).toMatchObject({
      pageviews: 0,
      uniqueSessions: 0,
      conversions: 0,
      topPaths: [],
      byType: [],
    });
  });
});
