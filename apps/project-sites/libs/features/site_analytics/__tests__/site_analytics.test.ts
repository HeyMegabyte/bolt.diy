/**
 * Unit tests for Site Analytics aggregation.
 *
 * Covers: correct rollup across contacts/forms/newsletter/donations, the
 * contacts bySource breakdown, org-ownership resolution, and the defensive
 * degrade-to-0 when a source table errors (missing/renamed).
 */

import { getSiteAnalyticsSummary, siteOrgId, FLAG_KEY } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

interface DbConfig {
  values: Record<string, number>; // keyed by metric tag
  bySource?: Array<{ source: string; n: number }>;
  orgId?: string | null;
  throwOn?: string; // substring that makes .all() throw (simulate missing table)
}

function makeEnv(cfg: DbConfig): Env {
  function prepare(sql: string) {
    let bound: unknown[] = [];
    const api = {
      bind: (...p: unknown[]) => {
        bound = p;
        return api;
      },
      all: async <T>(): Promise<{ results: T[] }> => {
        if (cfg.throwOn && sql.includes(cfg.throwOn)) throw new Error('no such table');
        if (sql.includes('SELECT org_id FROM sites')) {
          return { results: (cfg.orgId ? [{ org_id: cfg.orgId }] : []) as unknown as T[] };
        }
        if (sql.includes('FROM contacts') && sql.includes('GROUP BY source')) {
          return { results: (cfg.bySource ?? []) as unknown as T[] };
        }
        const tag = (() => {
          if (sql.includes('FROM contacts') && sql.includes('created_at >=')) return 'contactsNew';
          if (sql.includes('FROM contacts')) return 'contactsTotal';
          if (sql.includes('FROM form_submissions') && sql.includes('created_at >='))
            return 'formNew';
          if (sql.includes('FROM form_submissions')) return 'formTotal';
          if (sql.includes('newsletter_subscribers') && sql.includes('confirmed = 1'))
            return 'newsConfirmed';
          if (sql.includes('newsletter_subscribers')) return 'newsTotal';
          if (sql.includes('SUM(d.amount_cents)')) return 'donationsRaised';
          if (sql.includes('FROM donations')) return 'donationsCount';
          return 'unknown';
        })();
        void bound;
        return { results: [{ n: cfg.values[tag] ?? 0 }] as unknown as T[] };
      },
    };
    return api;
  }
  return { DB: { prepare } as unknown as D1Database } as unknown as Env;
}

describe('site_analytics service', () => {
  it('exposes the expected flag key', () => {
    expect(FLAG_KEY).toBe('site_analytics');
  });

  it('rolls up every metric and validates against the schema', async () => {
    const env = makeEnv({
      values: {
        contactsTotal: 42,
        contactsNew: 7,
        formTotal: 30,
        formNew: 5,
        newsConfirmed: 12,
        newsTotal: 20,
        donationsRaised: 150000,
        donationsCount: 9,
      },
      bySource: [
        { source: 'inbox', n: 30 },
        { source: 'newsletter', n: 12 },
      ],
      orgId: 'org1',
    });
    const s = await getSiteAnalyticsSummary(env, 'org1', 'site1', 30);
    expect(s.contacts.total).toBe(42);
    expect(s.contacts.newInWindow).toBe(7);
    expect(s.contacts.bySource).toEqual([
      { source: 'inbox', count: 30 },
      { source: 'newsletter', count: 12 },
    ]);
    expect(s.formSubmissions).toEqual({ total: 30, newInWindow: 5 });
    expect(s.newsletter).toEqual({ confirmed: 12, total: 20 });
    expect(s.donations).toEqual({ raisedCents: 150000, count: 9 });
    expect(s.windowDays).toBe(30);
    // Traffic block is present (visitor_events not seeded here → zeros, schema-valid).
    expect(s.traffic).toMatchObject({
      pageviews: 0,
      uniqueSessions: 0,
      conversions: 0,
      topPaths: [],
      byType: [],
    });
  });

  it('resolves a site to its owning org', async () => {
    expect(await siteOrgId(makeEnv({ values: {}, orgId: 'orgX' }), 'site1')).toBe('orgX');
    expect(await siteOrgId(makeEnv({ values: {}, orgId: null }), 'ghost')).toBeNull();
  });

  it('degrades a missing source table to 0 instead of throwing', async () => {
    const env = makeEnv({
      values: { contactsTotal: 5, formTotal: 3 },
      orgId: 'org1',
      throwOn: 'newsletter_subscribers',
    });
    const s = await getSiteAnalyticsSummary(env, 'org1', 'site1', 30);
    expect(s.newsletter).toEqual({ confirmed: 0, total: 0 });
    expect(s.contacts.total).toBe(5);
  });
});
