/**
 * GET /api/readiness?ids=… — batch Production-Readiness grades (backlog #9
 * follow-on). Replaces N per-row badge fetches with one request.
 *
 * Contract (reconciled 2026-08-17): the batch now runs the SAME live scorer as
 * the per-item route (`computeReadiness` from the prod_readiness_score module)
 * instead of reading the stale `workflow.build_validation` audit — so the
 * readiness BADGE (this batch) and the readiness PANEL (per-item) never disagree.
 * Previously a site with no new-style build audit returned null → the badge
 * rendered nothing while the panel showed a live grade (aggregate-drifts-from-
 * per-item). Now every OWNED, non-deleted site gets a live grade; an unowned /
 * missing id stays null; empty input → empty map; unauthenticated → 401.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { api } from '../routes/api.js';
import { errorHandler } from '../middleware/error_handler.js';
import { computeReadiness } from '../../libs/features/prod_readiness_score/service.js';

// The batch reuses the module's live scorer — mock it so the test drives grades
// directly without stubbing hostnames + R2 (those are covered by the module's own
// suite). We still stub D1 for the batch's own `sites` lookup.
jest.mock('../../libs/features/prod_readiness_score/service.js', () => ({
  computeReadiness: jest.fn(),
  fetchOwnedSite: jest.fn(),
  scoreToGrade: jest.fn(),
}));
const mockComputeReadiness = computeReadiness as jest.Mock;

interface SiteRow {
  id: string;
  slug: string;
  status: string;
  lighthouse_score: number | null;
  current_build_version: string | null;
  org_id: string;
}

/** Minimal D1 stub: prepare().bind().all() → { results }. Captures bind params. */
function makeDbStub(rows: SiteRow[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });
          return { all: async () => ({ results: rows }) };
        },
      };
    },
  };
  return { db: db as unknown as Env['DB'], calls };
}

function makeApp(vars: Partial<Variables>, env: Partial<Env>) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.orgId) c.set('orgId', vars.orgId);
    c.set('requestId', vars.requestId ?? 'test-req');
    await next();
  });
  app.route('/', api);
  return (path: string) => app.request(path, {}, env as Env);
}

/** Build a computeReadiness result with `passCount` of 4 checks passing. */
function readinessResult(passCount: number) {
  const names = ['published', 'custom_domain', 'performance', 'sitemap'] as const;
  const checks = names.map((name, i) => ({
    name,
    pass: i < passCount,
    weight: 25,
    hint: '',
  }));
  const score = passCount * 25;
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  return { score, grade, checks };
}

const siteRow = (id: string): SiteRow => ({
  id,
  slug: id,
  status: 'draft',
  lighthouse_score: null,
  current_build_version: null,
  org_id: 'org-1',
});

describe('GET /api/readiness (batch readiness)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires authentication', async () => {
    const { db } = makeDbStub([]);
    const req = makeApp({}, { DB: db });
    const res = await req('/api/readiness?ids=s1');
    expect(res.status).toBe(401);
  });

  it('returns an empty map for no ids', async () => {
    const { db } = makeDbStub([]);
    const req = makeApp({ orgId: 'org-1' }, { DB: db });
    const res = await req('/api/readiness');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({});
  });

  it('maps each requested id; owned→live grade, unowned/missing→null', async () => {
    // s1 + s2 are owned rows the sites query returns; s3 is NOT in the org's rows
    // (unowned / soft-deleted / never existed) → stays null.
    const { db, calls } = makeDbStub([siteRow('s1'), siteRow('s2')]);
    mockComputeReadiness.mockImplementation((_env: Env, site: SiteRow) =>
      Promise.resolve(readinessResult(site.id === 's1' ? 4 : 0)),
    );

    const req = makeApp({ orgId: 'org-1' }, { DB: db });
    const res = await req('/api/readiness?ids=s1,s2,s3');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };

    expect(Object.keys(data).sort()).toEqual(['s1', 's2', 's3']);
    // s1: all 4 checks pass → score 100 / grade A / passing true / summary counts.
    expect(data['s1']).toEqual(
      expect.objectContaining({
        grade: 'A',
        score: 100,
        passing: true,
        summary: '4/4 readiness checks passing',
      }),
    );
    // s2: 0 checks pass → grade F / passing false.
    expect(data['s2']).toEqual(expect.objectContaining({ grade: 'F', score: 0, passing: false }));
    expect(data['s3']).toBeNull();

    // The live scorer ran for each owned site (never for the unowned s3).
    expect(mockComputeReadiness).toHaveBeenCalledTimes(2);

    // Org-scoping: the sites query is filtered by org_id + the requested ids.
    expect(calls[0].sql).toMatch(/FROM sites/i);
    expect(calls[0].params[0]).toBe('org-1');
    expect(calls[0].params).toContain('s1');
    expect(calls[0].params).toContain('s3');
  });

  it('caps the id list at 100', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `s${i}`);
    const { db, calls } = makeDbStub([]);
    mockComputeReadiness.mockResolvedValue(readinessResult(0));
    const req = makeApp({ orgId: 'org-1' }, { DB: db });
    const res = await req(`/api/readiness?ids=${ids.join(',')}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(Object.keys(data).length).toBe(100);
    // org_id + 100 ids = 101 bind params.
    expect(calls[0].params.length).toBe(101);
  });
});
