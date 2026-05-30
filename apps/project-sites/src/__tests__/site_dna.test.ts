/**
 * @module __tests__/site_dna
 * @description Route + service tests for the Site DNA Taste Graph (#7),
 * focused on the multi-tenant isolation fix: the GET `/preferences` and
 * `/history` routes now require an authenticated org, and both read queries
 * scope by `org_id` in addition to `site_id`. Before the fix, either route
 * leaked another org's accepted-pattern signal to any caller who guessed a
 * `siteId` while the global `site_dna_taste_graph` flag was on.
 *
 * The route reads its flag directly from `feature_flags` via `env.DB.prepare`
 * (not the modules `isFlagOn`), and the service reads via `prepare().bind().all()`
 * — so this suite uses a single SQL-routing D1 double rather than the KV
 * harness, and captures the bound params to lock the `org_id` predicate.
 */

import { siteDna } from '../routes/site_dna.js';
import { getDnaPreferences, listDnaFeedback } from '../services/site_dna.js';
import { authApp } from './helpers/route_harness.js';
import type { Env } from '../types/env.js';

interface Captured {
  sql: string;
  params: unknown[];
}

/**
 * A D1 double that answers the flag lookup and captures any
 * `site_dna_feedback` query's SQL + bound params.
 */
function dnaDb(flagOn: boolean, sink?: Captured[]): Env['DB'] {
  return {
    prepare: (sql: string) => ({
      // assertFlagOn: `.prepare(...).first()` with no bind
      first: async () =>
        /feature_flags/.test(sql) ? (flagOn ? { enabled: 1 } : { enabled: 0 }) : null,
      bind: (...params: unknown[]) => ({
        first: async () => null,
        all: async () => {
          if (/site_dna_feedback/.test(sql)) sink?.push({ sql, params });
          return { results: [] };
        },
        run: async () => ({ meta: {} }),
      }),
    }),
  } as unknown as Env['DB'];
}

const env = (flagOn: boolean, sink?: Captured[]) => ({ DB: dnaDb(flagOn, sink) }) as unknown as Env;

const PREFS = '/api/site-dna/site1/preferences';
const HISTORY = '/api/site-dna/site1/history';

// ─── service: getDnaPreferences (tenant-scoped SQL) ──────────────────
describe('getDnaPreferences (tenant-scoped)', () => {
  it('scopes the query by org_id AND site_id', async () => {
    const sink: Captured[] = [];
    await getDnaPreferences(env(true, sink), 'org-a', 'site1');
    expect(sink).toHaveLength(1);
    expect(sink[0]!.sql).toContain('org_id = ? AND site_id = ?');
    expect(sink[0]!.params).toEqual(['org-a', 'site1']);
  });

  it('binds the class filter after org+site when provided', async () => {
    const sink: Captured[] = [];
    await getDnaPreferences(env(true, sink), 'org-a', 'site1', 'hero');
    expect(sink[0]!.params).toEqual(['org-a', 'site1', 'hero']);
  });
});

// ─── service: listDnaFeedback (tenant-scoped SQL) ────────────────────
describe('listDnaFeedback (tenant-scoped)', () => {
  it('scopes the query by org_id AND site_id', async () => {
    const sink: Captured[] = [];
    await listDnaFeedback(env(true, sink), 'org-a', 'site1', 25);
    expect(sink).toHaveLength(1);
    expect(sink[0]!.sql).toContain('org_id = ? AND site_id = ?');
    expect(sink[0]!.params).toEqual(['org-a', 'site1', 25]);
  });
});

// ─── route: GET /preferences ─────────────────────────────────────────
describe('site_dna GET /preferences (isolation)', () => {
  it('404 when the flag is off', async () => {
    const app = authApp(siteDna, { userId: 'u', orgId: 'org-a' });
    expect((await app.request(PREFS, {}, env(false))).status).toBe(404);
  });

  it('401 when authenticated org is missing (was a cross-org read leak)', async () => {
    const app = authApp(siteDna); // no orgId injected
    expect((await app.request(PREFS, {}, env(true))).status).toBe(401);
  });

  it('200 + binds the caller org into the read for an authenticated caller', async () => {
    const sink: Captured[] = [];
    const app = authApp(siteDna, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(PREFS, {}, env(true, sink));
    expect(res.status).toBe(200);
    expect(sink[0]!.params[0]).toBe('org-a'); // org_id is the first bound param
  });
});

// ─── route: GET /history ─────────────────────────────────────────────
describe('site_dna GET /history (isolation)', () => {
  it('404 when the flag is off', async () => {
    const app = authApp(siteDna, { userId: 'u', orgId: 'org-a' });
    expect((await app.request(HISTORY, {}, env(false))).status).toBe(404);
  });

  it('401 when authenticated org is missing (was a cross-org read leak)', async () => {
    const app = authApp(siteDna);
    expect((await app.request(HISTORY, {}, env(true))).status).toBe(401);
  });

  it('200 + binds the caller org into the read', async () => {
    const sink: Captured[] = [];
    const app = authApp(siteDna, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(HISTORY, {}, env(true, sink));
    expect(res.status).toBe(200);
    expect(sink[0]!.params[0]).toBe('org-a');
  });
});

// ─── route: POST /feedback (auth gate already present) ───────────────
describe('site_dna POST /feedback', () => {
  const body = JSON.stringify({ component_id: 'hero-1', action: 'accept' });
  const headers = { 'content-type': 'application/json' };

  it('404 when the flag is off', async () => {
    const app = authApp(siteDna, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(
      '/api/site-dna/site1/feedback',
      { method: 'POST', headers, body },
      env(false),
    );
    expect(res.status).toBe(404);
  });

  it('401 when org is missing', async () => {
    const app = authApp(siteDna, { userId: 'u' });
    const res = await app.request(
      '/api/site-dna/site1/feedback',
      { method: 'POST', headers, body },
      env(true),
    );
    expect(res.status).toBe(401);
  });

  it('201 recording feedback for an authenticated caller', async () => {
    const app = authApp(siteDna, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(
      '/api/site-dna/site1/feedback',
      { method: 'POST', headers, body },
      env(true),
    );
    expect(res.status).toBe(201);
    const out = (await res.json()) as { site_id: string; action: string };
    expect(out.site_id).toBe('site1');
    expect(out.action).toBe('accept');
  });

  it('400 on an invalid action enum', async () => {
    const app = authApp(siteDna, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(
      '/api/site-dna/site1/feedback',
      { method: 'POST', headers, body: JSON.stringify({ component_id: 'x', action: 'nope' }) },
      env(true),
    );
    expect(res.status).toBe(400);
  });
});
