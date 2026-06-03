/**
 * @module __tests__/brilliant
 * @description Additive unit coverage for the "10 brilliant features" consolidated
 * service (`services/brilliant.ts`). Each exported function reads/writes a
 * `0502_brilliant_ten.sql` table via the `env.DB.prepare().bind().first()/all()/run()`
 * chain and returns mock-realistic shapes when the row is absent (per
 * [[secret-provisioning]] graceful-degradation). This suite exercises every real
 * branch of the surface:
 *   - #1  buildSiteMcpManifest        — site found / site missing (mock slug+name) fallbacks
 *   - #2  cold-tier                   — getColdTierState (row / no-row), archive, thaw
 *   - #3  ai-router                   — classifyPromptShape (all 4 shapes), autoRoutePrompt
 *                                       (model pick per shape), getRouterStats (empty / populated + savings)
 *   - #4  ghost routes                — eligibility (exact + wildcard + miss), track, preview
 *                                       (eligible + not-in-allowlist), list
 *   - #5  speed compare               — score derivation + share token + advantage_pct
 *   - #6  auto-gen files              — list (generated/pending split), regenerate (known + unknown)
 *   - #7  hallucination guard         — cited / flagged (year+number) / flagged (named entity) paths, list
 *   - #8  visitor recognition         — segment thresholds + personalized hero (default/returning/engaged)
 *   - #9  faq-from-tickets            — clustering + empty input, list
 *   - #10 competitor monitor          — even/odd-seed alert count, list
 *
 * D1 is mocked via a small configurable stub; `crypto` is the Node 22 global
 * (randomUUID + subtle.digest). No real network/APIs are ever hit.
 *
 * ts-jest: GLOBAL `jest` (NOT @jest/globals); casts use `as unknown as jest.Mock`.
 */

import {
  buildSiteMcpManifest,
  getColdTierState,
  archiveSiteToColdTier,
  thawSiteFromColdTier,
  classifyPromptShape,
  autoRoutePrompt,
  getRouterStats,
  isGhostRouteEligible,
  trackGhostRouteHit,
  previewGhostRoute,
  listGhostRoutes,
  runSpeedCompare,
  listAutoGenFiles,
  regenerateAutoGenFile,
  AUTO_GEN_FILE_REGISTRY,
  checkHallucination,
  listHallucinationFlags,
  recognizeVisitor,
  getPersonalizedHero,
  clusterTicketsIntoFaq,
  listFaqDrafts,
  scanCompetitors,
  listCompetitorAlerts,
} from '../services/brilliant.js';
import type { Env } from '../types/env.js';

// ─── D1 mock harness ──────────────────────────────────────────
// Records every prepared SQL + bound params, and resolves first()/all()
// from per-test FIFO queues. `run()` is a no-op recorder. Any of the chain
// methods can be made to throw to exercise the service's `.catch()` branches.

interface PreparedRecord {
  sql: string;
  params: unknown[];
}

interface DbHarness {
  db: Env['DB'];
  prepared: PreparedRecord[];
  firstQueue: unknown[];
  allQueue: Array<{ results?: unknown[] }>;
  runCalls: PreparedRecord[];
  /** when true, prepare() returns a chain whose terminal ops reject */
  throwAll: boolean;
}

function makeDb(opts?: { throwAll?: boolean }): DbHarness {
  const harness: DbHarness = {
    db: undefined as unknown as Env['DB'],
    prepared: [],
    firstQueue: [],
    allQueue: [],
    runCalls: [],
    throwAll: opts?.throwAll ?? false,
  };

  const makeStatement = (sql: string) => {
    const rec: PreparedRecord = { sql, params: [] };
    const stmt = {
      bind: (...params: unknown[]) => {
        rec.params = params;
        harness.prepared.push(rec);
        return stmt;
      },
      first: async <T,>(): Promise<T | null> => {
        if (harness.throwAll) throw new Error('d1 down');
        return (harness.firstQueue.shift() ?? null) as T | null;
      },
      all: async <T,>(): Promise<{ results?: T[] }> => {
        if (harness.throwAll) throw new Error('d1 down');
        return (harness.allQueue.shift() ?? { results: [] }) as { results?: T[] };
      },
      run: async () => {
        if (harness.throwAll) throw new Error('d1 down');
        harness.runCalls.push(rec);
        return { meta: {} };
      },
    };
    return stmt;
  };

  harness.db = {
    prepare: (sql: string) => makeStatement(sql),
  } as unknown as Env['DB'];

  return harness;
}

function envFrom(h: DbHarness): Env {
  return { DB: h.db } as unknown as Env;
}

describe('brilliant service — 10 features (additive unit coverage)', () => {
  // ── #1 Site-as-MCP-server ──────────────────────────────────
  describe('buildSiteMcpManifest', () => {
    it('uses real site slug + name when the row is present', async () => {
      const h = makeDb();
      h.firstQueue.push({ slug: 'acme', name: 'Acme Co' });
      const m = await buildSiteMcpManifest(envFrom(h), 'site-123');
      expect(m.name).toBe('acme.projectsites.dev');
      expect(m.description).toContain('Acme Co');
      expect(m.tools).toHaveLength(5);
      expect(m.tools.map((t) => t.name)).toEqual(
        expect.arrayContaining(['get_hours', 'get_menu', 'book_appointment', 'submit_lead', 'ask_about']),
      );
      expect(m.transport.endpoint).toBe('https://acme.projectsites.dev/mcp/sse');
      expect(m.site_id).toBe('site-123');
      expect(typeof m.generated_at).toBe('string');
    });

    it('falls back to a demo slug/name when site missing', async () => {
      const h = makeDb();
      // firstQueue empty -> first() returns null
      const m = await buildSiteMcpManifest(envFrom(h), 'abcdef0123456789');
      expect(m.name).toBe('demo-abcdef01.projectsites.dev');
      expect(m.description).toContain('Demo customer site');
    });

    it('treats a D1 throw as "site missing" (catch branch)', async () => {
      const h = makeDb({ throwAll: true });
      const m = await buildSiteMcpManifest(envFrom(h), 'ffffffffffff');
      expect(m.name).toBe('demo-ffffffff.projectsites.dev');
    });
  });

  // ── #2 Cold-tier auto-thaw ─────────────────────────────────
  describe('cold-tier', () => {
    it('getColdTierState returns warm default when no row', async () => {
      const h = makeDb();
      const s = await getColdTierState(envFrom(h), 'site-1');
      expect(s.state).toBe('warm');
      expect(s.thaw_count).toBe(0);
      expect(s.site_id).toBe('site-1');
    });

    it('getColdTierState spreads the row when present', async () => {
      const h = makeDb();
      h.firstQueue.push({ state: 'frozen', last_active_at: 'x', archived_at: 'y', thawed_at: null, thaw_count: 3, r2_archive_key: 'k' });
      const s = (await getColdTierState(envFrom(h), 'site-2')) as Record<string, unknown>;
      expect(s.state).toBe('frozen');
      expect(s.thaw_count).toBe(3);
    });

    it('archiveSiteToColdTier writes frozen state + savings estimate', async () => {
      const h = makeDb();
      const r = await archiveSiteToColdTier(envFrom(h), 'site-3');
      expect(r.state).toBe('frozen');
      expect(r.r2_archive_key).toBe('cold-archive/site-3.tar.zst');
      expect(r.estimated_storage_savings_pct).toBe(88);
      expect(h.runCalls.length).toBe(1);
    });

    it('thawSiteFromColdTier returns warm + a duration', async () => {
      const h = makeDb();
      const r = await thawSiteFromColdTier(envFrom(h), 'site-4');
      expect(r.state).toBe('warm');
      expect(typeof r.thaw_duration_ms).toBe('number');
      expect(r.target_thaw_ms).toBe(30_000);
    });

    it('archive swallows a D1 throw and still returns the shape', async () => {
      const h = makeDb({ throwAll: true });
      const r = await archiveSiteToColdTier(envFrom(h), 'site-5');
      expect(r.state).toBe('frozen');
    });
  });

  // ── #3 AI auto-router ──────────────────────────────────────
  describe('classifyPromptShape', () => {
    it('classifies architectural prompts as complex', () => {
      const c = classifyPromptShape('Please refactor the migration safety invariant');
      expect(c.shape).toBe('complex');
      expect(c.confidence).toBeGreaterThan(0.8);
    });

    it('classifies very long prompts as complex', () => {
      const c = classifyPromptShape('a'.repeat(1600));
      expect(c.shape).toBe('complex');
    });

    it('classifies creative prompts', () => {
      const c = classifyPromptShape('write copy with a punchy brand voice tagline');
      expect(c.shape).toBe('creative');
    });

    it('classifies short / leading-keyword prompts as free_eligible', () => {
      expect(classifyPromptShape('format this').shape).toBe('free_eligible');
      expect(classifyPromptShape('what time is it').shape).toBe('free_eligible');
      expect(classifyPromptShape('hi').shape).toBe('free_eligible'); // length < 80
    });

    it('falls through to simple for a mid-length non-keyword prompt', () => {
      const c = classifyPromptShape('Could you please update the contact section copy to mention our new hours and email today for the team');
      expect(c.shape).toBe('simple');
      expect(c.confidence).toBe(0.6);
    });

    it('handles null/undefined prompt without throwing', () => {
      // @ts-expect-error exercising the `?? ''` guard
      const c = classifyPromptShape(undefined);
      expect(c.shape).toBe('free_eligible'); // length 0 < 80
    });
  });

  describe('autoRoutePrompt', () => {
    it('picks opus for complex', async () => {
      const h = makeDb();
      const r = await autoRoutePrompt(envFrom(h), { prompt: 'refactor architecture safety', orgId: 'org-1' });
      expect(r.picked_model).toBe('claude-opus-4-7');
      expect(r.classification).toBe('complex');
      expect(r.estimated_cost_usd).toBeGreaterThan(0);
      expect(r.alternatives).toHaveLength(3);
      expect(h.runCalls.length).toBe(1);
    });

    it('picks sonnet for creative', async () => {
      const h = makeDb();
      const r = await autoRoutePrompt(envFrom(h), { prompt: 'write copy tagline brand voice' });
      expect(r.picked_model).toBe('claude-sonnet-4-6');
    });

    it('picks free Llama for free_eligible and reports zero cost', async () => {
      const h = makeDb();
      const r = await autoRoutePrompt(envFrom(h), { prompt: 'list things' });
      expect(r.picked_model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
      expect(r.estimated_cost_usd).toBe(0);
    });

    it('picks free Llama for the simple fallthrough too', async () => {
      const h = makeDb();
      const r = await autoRoutePrompt(envFrom(h), {
        prompt: 'Could you please update the contact section copy to mention our new hours and email today',
      });
      expect(r.classification).toBe('simple');
      expect(r.picked_model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    });

    it('swallows a D1 throw and still returns a decision', async () => {
      const h = makeDb({ throwAll: true });
      const r = await autoRoutePrompt(envFrom(h), { prompt: 'list things' });
      expect(r.decision_id).toBeTruthy();
    });
  });

  describe('getRouterStats', () => {
    it('returns zeros when no decisions', async () => {
      const h = makeDb();
      const s = await getRouterStats(envFrom(h), 'org-1');
      expect(s.total_decisions).toBe(0);
      expect(s.savings_pct).toBe(0);
    });

    it('aggregates by model and computes savings vs always-opus baseline', async () => {
      const h = makeDb();
      h.allQueue.push({
        results: [
          { picked_model: 'claude-opus-4-7', count: 1 },
          { picked_model: 'claude-sonnet-4-6', count: 2 },
          { picked_model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', count: 7 },
        ],
      });
      const s = await getRouterStats(envFrom(h), 'org-1');
      expect(s.total_decisions).toBe(10);
      expect(s.by_model['claude-opus-4-7']).toBe(1);
      expect(s.always_opus_baseline_usd).toBe(0.15);
      // actual = 1*0.015 + 2*0.003 = 0.021 -> toFixed(2) = 0.02
      expect(s.estimated_actual_usd).toBe(0.02);
      expect(s.savings_pct).toBeGreaterThan(0);
    });

    it('swallows a D1 throw -> empty stats', async () => {
      const h = makeDb({ throwAll: true });
      const s = await getRouterStats(envFrom(h), 'org-1');
      expect(s.total_decisions).toBe(0);
    });
  });

  // ── #4 Ghost routes ────────────────────────────────────────
  describe('ghost routes', () => {
    it('isGhostRouteEligible matches exact + wildcard, rejects others', () => {
      expect(isGhostRouteEligible('/pricing')).toBe(true);
      expect(isGhostRouteEligible('/services/plumbing')).toBe(true); // wildcard
      expect(isGhostRouteEligible('/admin')).toBe(false);
      expect(isGhostRouteEligible('/random-page')).toBe(false);
    });

    it('trackGhostRouteHit upserts and reads back the row', async () => {
      const h = makeDb();
      h.firstQueue.push({ id: 'g1', site_id: 'site-1', path: '/faq', hit_count: 2 });
      const row = await trackGhostRouteHit(envFrom(h), 'site-1', '/faq');
      expect(h.runCalls.length).toBe(1);
      expect((row as Record<string, unknown>).hit_count).toBe(2);
    });

    it('previewGhostRoute returns an error for non-allowlisted path', async () => {
      const h = makeDb();
      const r = (await previewGhostRoute(envFrom(h), { siteId: 'site-1', path: '/secret' })) as Record<string, unknown>;
      expect(r.error).toBe('path_not_in_allowlist');
      expect(r.allowlist).toBeDefined();
    });

    it('previewGhostRoute generates HTML preview for an eligible path', async () => {
      const h = makeDb();
      const r = (await previewGhostRoute(envFrom(h), { siteId: 'abcdef0123', path: '/pricing' })) as Record<string, unknown>;
      expect(r.status).toBe('preview');
      expect(r.path).toBe('/pricing');
      expect(typeof r.byte_size).toBe('number');
      expect(String(r.html_preview)).toContain('<h1>/pricing</h1>');
      expect(String(r.r2_key)).toContain('/pricing.html');
    });

    it('listGhostRoutes returns results, empty on throw', async () => {
      const ok = makeDb();
      ok.allQueue.push({ results: [{ id: 'g1' }] });
      expect((await listGhostRoutes(envFrom(ok), 'site-1')).length).toBe(1);

      const bad = makeDb({ throwAll: true });
      expect(await listGhostRoutes(envFrom(bad), 'site-1')).toEqual([]);
    });
  });

  // ── #5 Speed-compare widget ────────────────────────────────
  describe('runSpeedCompare', () => {
    it('derives scores, share token, embed snippet and persists', async () => {
      const h = makeDb();
      const r = await runSpeedCompare(envFrom(h), { customerSite: 'https://acme.com', competitorUrl: 'https://rival.com' });
      expect(r.customer_score).toBeGreaterThanOrEqual(75);
      expect(r.customer_score).toBeLessThanOrEqual(99);
      expect(r.competitor_score).toBeGreaterThanOrEqual(55);
      expect(r.competitor_score).toBeLessThanOrEqual(84);
      expect(r.share_token).toHaveLength(12);
      expect(r.share_url).toContain(r.share_token);
      expect(r.embed_snippet).toContain(r.share_token);
      expect(typeof r.advantage_pct).toBe('number');
      expect(h.runCalls.length).toBe(1);
    });

    it('is deterministic for the same inputs (seeded by sha256)', async () => {
      const a = await runSpeedCompare(envFrom(makeDb()), { customerSite: 'https://x.com', competitorUrl: 'https://y.com' });
      const b = await runSpeedCompare(envFrom(makeDb()), { customerSite: 'https://x.com', competitorUrl: 'https://y.com' });
      expect(a.customer_score).toBe(b.customer_score);
      expect(a.competitor_score).toBe(b.competitor_score);
    });
  });

  // ── #6 Auto-gen 50 static files ────────────────────────────
  describe('auto-gen files', () => {
    it('listAutoGenFiles splits generated vs pending', async () => {
      const h = makeDb();
      h.allQueue.push({ results: [{ filename: 'robots.txt', generated_at: 't', byte_size: 100 }] });
      const r = await listAutoGenFiles(envFrom(h), 'site-1');
      expect(r.total).toBe(AUTO_GEN_FILE_REGISTRY.length);
      expect(r.generated_count).toBe(1);
      expect(r.pending_count).toBe(AUTO_GEN_FILE_REGISTRY.length - 1);
      const robots = r.files.find((f) => f.filename === 'robots.txt');
      expect(robots?.status).toBe('generated');
      const pending = r.files.find((f) => f.filename === 'humans.txt');
      expect(pending?.status).toBe('pending');
    });

    it('listAutoGenFiles handles a D1 throw (all pending)', async () => {
      const h = makeDb({ throwAll: true });
      const r = await listAutoGenFiles(envFrom(h), 'site-1');
      expect(r.generated_count).toBe(0);
    });

    it('regenerateAutoGenFile errors for an unknown filename', async () => {
      const h = makeDb();
      const r = (await regenerateAutoGenFile(envFrom(h), { siteId: 'site-1', filename: 'nope.txt' })) as Record<string, unknown>;
      expect(r.error).toBe('unknown_file');
    });

    it('regenerateAutoGenFile uses bigger size for social/favicon assets', async () => {
      const h = makeDb();
      const social = (await regenerateAutoGenFile(envFrom(h), { siteId: 'site-1', filename: 'og-image.png' })) as Record<string, unknown>;
      expect(social.byte_size).toBe(14_500);
      expect(social.category).toBe('social');

      const text = (await regenerateAutoGenFile(envFrom(h), { siteId: 'site-1', filename: 'robots.txt' })) as Record<string, unknown>;
      expect(text.byte_size).toBe(2_400);
      expect(h.runCalls.length).toBe(2);
    });
  });

  // ── #7 Hallucination guard ─────────────────────────────────
  describe('hallucination guard', () => {
    it('classifies plain text as cited with a source ref', async () => {
      const h = makeDb();
      const r = await checkHallucination(envFrom(h), { siteId: 'site-1', pageRoute: '/about', text: 'we are friendly local folks' });
      expect(r.classification).toBe('cited');
      expect(r.source_ref).toContain('_research.json#');
      expect(r.publish_blocked).toBe(false);
    });

    it('flags text with both a year and a large number', async () => {
      const h = makeDb();
      const r = await checkHallucination(envFrom(h), { siteId: 'site-1', pageRoute: '/about', text: 'Founded in 1998 we served 4500 meals' });
      expect(r.classification).toBe('flagged');
      expect(r.source_ref).toBeNull();
      expect(r.confidence).toBe(0.7);
    });

    it('flags a named entity without a year', async () => {
      const h = makeDb();
      const r = await checkHallucination(envFrom(h), { siteId: 'site-1', pageRoute: '/team', text: 'Led by John Smith our team is great' });
      expect(r.classification).toBe('flagged');
      expect(r.confidence).toBe(0.65);
    });

    it('listHallucinationFlags returns rows, empty on throw', async () => {
      const ok = makeDb();
      ok.allQueue.push({ results: [{ id: 'f1' }] });
      expect((await listHallucinationFlags(envFrom(ok), 'site-1')).length).toBe(1);
      const bad = makeDb({ throwAll: true });
      expect(await listHallucinationFlags(envFrom(bad), 'site-1')).toEqual([]);
    });
  });

  // ── #8 Visitor recognition ─────────────────────────────────
  describe('visitor recognition', () => {
    it('first_visit segment for a brand-new visitor', async () => {
      const h = makeDb();
      h.firstQueue.push({ visit_count: 1, first_seen_at: 't', source: 'google', city: 'Newark' });
      const r = await recognizeVisitor(envFrom(h), { siteId: 'site-1', anonId: 'a1', source: 'google', city: 'Newark', country: 'US' });
      expect(r.segment).toBe('first_visit');
      expect(r.is_returning).toBe(false);
    });

    it('returning segment at 2 visits', async () => {
      const h = makeDb();
      h.firstQueue.push({ visit_count: 2 });
      const r = await recognizeVisitor(envFrom(h), { siteId: 'site-1', anonId: 'a2' });
      expect(r.segment).toBe('returning');
      expect(r.is_returning).toBe(true);
    });

    it('engaged segment at 5+ visits', async () => {
      const h = makeDb();
      h.firstQueue.push({ visit_count: 6 });
      const r = await recognizeVisitor(envFrom(h), { siteId: 'site-1', anonId: 'a3' });
      expect(r.segment).toBe('engaged');
    });

    it('defaults visit_count to 1 when row read fails', async () => {
      const h = makeDb({ throwAll: true });
      const r = await recognizeVisitor(envFrom(h), { siteId: 'site-1', anonId: 'a4' });
      expect(r.visit_count).toBe(1);
      expect(r.segment).toBe('first_visit');
    });

    it('getPersonalizedHero returns default for new/low visitors', async () => {
      const h = makeDb(); // no row
      const hero = await getPersonalizedHero(envFrom(h), { siteId: 'site-1', anonId: 'a5' });
      expect(hero.variant).toBe('default');
    });

    it('getPersonalizedHero returns returning for 2-4 visits', async () => {
      const h = makeDb();
      h.firstQueue.push({ visit_count: 3, source: 'x', city: 'Newark' });
      const hero = await getPersonalizedHero(envFrom(h), { siteId: 'site-1', anonId: 'a6' });
      expect(hero.variant).toBe('returning');
      expect(hero.cta).toBe('Watch demo');
    });

    it('getPersonalizedHero returns engaged for 5+ visits with city', async () => {
      const h = makeDb();
      h.firstQueue.push({ visit_count: 8, source: 'x', city: 'Hoboken' });
      const hero = await getPersonalizedHero(envFrom(h), { siteId: 'site-1', anonId: 'a7' });
      expect(hero.variant).toBe('engaged');
      expect(hero.sub).toContain('Hoboken');
    });
  });

  // ── #9 FAQ-from-tickets ────────────────────────────────────
  describe('faq-from-tickets', () => {
    it('clusters tickets by body prefix and persists drafts', async () => {
      const h = makeDb();
      const tickets = [
        { id: 't1', body: 'How do I reset my password please' },
        { id: 't2', body: 'How do I reset my password please again' },
        { id: 't3', body: 'What are your business hours' },
      ];
      const r = await clusterTicketsIntoFaq(envFrom(h), { siteId: 'site-1', tickets });
      expect(r.total_tickets).toBe(3);
      expect(r.total_clusters).toBeGreaterThanOrEqual(1);
      expect(r.drafts[0].cluster_size).toBeGreaterThanOrEqual(1);
      expect(h.runCalls.length).toBe(r.drafts.length);
    });

    it('handles empty / undefined tickets', async () => {
      const h = makeDb();
      const r = await clusterTicketsIntoFaq(envFrom(h), { siteId: 'site-1', tickets: [] });
      expect(r.total_tickets).toBe(0);
      expect(r.drafts).toEqual([]);
    });

    it('groups empty-body tickets under "misc"', async () => {
      const h = makeDb();
      const r = await clusterTicketsIntoFaq(envFrom(h), { siteId: 'site-1', tickets: [{ id: 'x', body: '' }] });
      expect(r.total_clusters).toBe(1);
    });

    it('listFaqDrafts returns rows, empty on throw', async () => {
      const ok = makeDb();
      ok.allQueue.push({ results: [{ id: 'd1' }] });
      expect((await listFaqDrafts(envFrom(ok), 'site-1')).length).toBe(1);
      const bad = makeDb({ throwAll: true });
      expect(await listFaqDrafts(envFrom(bad), 'site-1')).toEqual([]);
    });
  });

  // ── #10 Competitor monitor ─────────────────────────────────
  describe('competitor monitor', () => {
    it('returns 3 alerts for an even-seed org and persists them', async () => {
      const h = makeDb();
      // charCodeAt('@') = 64 -> even -> includes the third alert
      const r = await scanCompetitors(envFrom(h), '@evenorg');
      expect(r.alerts.length).toBe(3);
      expect(r.alerts.map((a) => a.alert_type)).toContain('feature_ship');
      expect(h.runCalls.length).toBe(3);
      expect(r.org_id).toBe('@evenorg');
    });

    it('returns 2 alerts for an odd-seed org', async () => {
      const h = makeDb();
      // 'a'.charCodeAt(0) = 97 -> odd -> no feature_ship alert
      const r = await scanCompetitors(envFrom(h), 'aoddorg');
      expect(r.alerts.length).toBe(2);
    });

    it('still returns alerts when D1 insert throws', async () => {
      const h = makeDb({ throwAll: true });
      const r = await scanCompetitors(envFrom(h), 'aoddorg');
      expect(r.alerts.length).toBe(2);
    });

    it('listCompetitorAlerts returns rows, empty on throw', async () => {
      const ok = makeDb();
      ok.allQueue.push({ results: [{ id: 'c1' }] });
      expect((await listCompetitorAlerts(envFrom(ok), 'org-1')).length).toBe(1);
      const bad = makeDb({ throwAll: true });
      expect(await listCompetitorAlerts(envFrom(bad), 'org-1')).toEqual([]);
    });
  });
});
