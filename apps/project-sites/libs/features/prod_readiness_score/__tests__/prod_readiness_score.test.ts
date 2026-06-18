/**
 * Tests for the Production Readiness Score feature.
 *
 * Mocks: isFlagOn, dbQueryOne, dbQuery, SITES_BUCKET.head
 * Coverage:
 *   - flag-off → 404
 *   - unauthenticated → 401
 *   - unknown site → 404
 *   - all checks passing → score 100, grade A
 *   - all checks failing → score 0, grade F
 *   - partial checks → correct score + grade
 *   - R2 error treated as sitemap=false (no 500)
 *   - scoreToGrade boundaries
 *   - null lighthouse_score → performance check fails
 */
import { Hono } from 'hono';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

const mockDbQueryOne = jest.fn();
const mockDbQuery = jest.fn();
jest.mock('../../../../src/services/db.js', () => ({
  dbQueryOne: (...a: unknown[]) => mockDbQueryOne(...a),
  dbQuery: (...a: unknown[]) => mockDbQuery(...a),
  dbInsert: jest.fn().mockResolvedValue({}),
  dbExecute: jest.fn().mockResolvedValue(undefined),
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

import { prodReadinessScore } from '../handlers.js';
import { scoreToGrade } from '../service.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fake SITES_BUCKET for the Env binding. */
function makeBucket(headResult: object | null = null, throws = false) {
  return {
    head: jest.fn().mockImplementation(() => {
      if (throws) throw new Error('R2 error');
      return Promise.resolve(headResult);
    }),
  };
}

const BASE_SITE = {
  id: 'site-001',
  slug: 'acme',
  status: 'published',
  lighthouse_score: 95,
  current_build_version: '2026-01-01T00-00-00-000Z',
  org_id: 'org-abc',
};

function app(siteBucket = makeBucket({ size: 100 })) {
  const env = { SITES_BUCKET: siteBucket } as unknown;
  const a = new Hono();
  a.route('/', prodReadinessScore);
  return a.request(
    '/api/sites/site-001/readiness',
    { method: 'GET' },
    env as never,
    { waitUntil() {}, passThroughOnException() {} } as never,
  );
}

/** Convenience wrapper that sets up common mocks and issues the request. */
async function getReadiness({
  flagOn = true,
  orgId = 'org-abc',
  site = BASE_SITE,
  hostnames = [{ type: 'custom_cname', status: 'active' }],
  bucket = makeBucket({ size: 100 }),
}: {
  flagOn?: boolean;
  orgId?: string | null;
  site?: typeof BASE_SITE | null;
  hostnames?: { type: string; status: string }[];
  bucket?: ReturnType<typeof makeBucket>;
} = {}) {
  mockIsFlagOn.mockResolvedValue(flagOn);
  mockDbQueryOne.mockResolvedValue(site);
  mockDbQuery.mockResolvedValue({ data: hostnames, error: null });

  const env = { SITES_BUCKET: bucket } as unknown;
  const a = new Hono();
  a.route('/', prodReadinessScore);

  // Simulate Variables middleware having set orgId
  if (orgId) {
    a.use('*', (c, next) => {
      c.set('orgId' as never, orgId as never);
      return next();
    });
    // Re-attach the handler AFTER the middleware (middleware applied before route)
    // The simplest way: rebuild the app with the right order.
  }

  // Rebuild with correct middleware order
  const a2 = new Hono();
  if (orgId) {
    a2.use('*', (c, next) => {
      c.set('orgId' as never, orgId as never);
      return next();
    });
  }
  a2.route('/', prodReadinessScore);

  return a2.request(
    '/api/sites/site-001/readiness',
    { method: 'GET' },
    env as never,
    { waitUntil() {}, passThroughOnException() {} } as never,
  );
}

// ── Reset ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockIsFlagOn.mockReset();
  mockDbQueryOne.mockReset();
  mockDbQuery.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/sites/:siteId/readiness', () => {
  it('returns 404 when the feature flag is off', async () => {
    const res = await getReadiness({ flagOn: false });
    expect(res.status).toBe(404);
  });

  it('returns 401 when orgId is not set', async () => {
    const res = await getReadiness({ orgId: null });
    expect(res.status).toBe(401);
  });

  it('returns 404 when site is not owned by the org', async () => {
    const res = await getReadiness({ site: null });
    expect(res.status).toBe(404);
  });

  it('returns score 100, grade A when all four checks pass', async () => {
    const res = await getReadiness();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { score: number; grade: string; checks: { name: string; pass: boolean }[] };
    expect(body.score).toBe(100);
    expect(body.grade).toBe('A');
    expect(body.checks).toHaveLength(4);
    body.checks.forEach((c) => expect(c.pass).toBe(true));
  });

  it('returns score 0, grade F when all checks fail', async () => {
    const res = await getReadiness({
      site: {
        ...BASE_SITE,
        status: 'draft',
        lighthouse_score: 50,
        current_build_version: null,
      },
      hostnames: [],
      bucket: makeBucket(null), // sitemap not found
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { score: number; grade: string };
    expect(body.score).toBe(0);
    expect(body.grade).toBe('F');
  });

  it('returns score 50 when only published + custom domain pass', async () => {
    const res = await getReadiness({
      site: {
        ...BASE_SITE,
        lighthouse_score: 80, // <90 → fails performance check
        current_build_version: null, // no sitemap check possible
      },
      hostnames: [{ type: 'custom_cname', status: 'active' }],
      bucket: makeBucket(null),
    });
    const body = (await res.json()) as { score: number; grade: string };
    // published(25) + custom_domain(25) = 50
    expect(body.score).toBe(50);
    expect(body.grade).toBe('F');
  });

  it('treats a null lighthouse_score as a performance check failure', async () => {
    const res = await getReadiness({
      site: { ...BASE_SITE, lighthouse_score: null },
    });
    const body = (await res.json()) as { checks: { name: string; pass: boolean }[] };
    const perfCheck = body.checks.find((c) => c.name === 'performance');
    expect(perfCheck?.pass).toBe(false);
  });

  it('degrades to sitemap=false (no 500) when R2 throws', async () => {
    const res = await getReadiness({ bucket: makeBucket(null, true) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks: { name: string; pass: boolean }[] };
    const sitemapCheck = body.checks.find((c) => c.name === 'sitemap');
    expect(sitemapCheck?.pass).toBe(false);
  });

  it('includes a hint string on every check', async () => {
    const res = await getReadiness();
    const body = (await res.json()) as { checks: { name: string; hint: string }[] };
    body.checks.forEach((c) => {
      expect(typeof c.hint).toBe('string');
      expect(c.hint.length).toBeGreaterThan(0);
    });
  });
});

// ── scoreToGrade unit tests ───────────────────────────────────────────────────

describe('scoreToGrade', () => {
  it.each([
    [100, 'A'],
    [90, 'A'],
    [89, 'B'],
    [80, 'B'],
    [79, 'C'],
    [70, 'C'],
    [69, 'D'],
    [60, 'D'],
    [59, 'F'],
    [0, 'F'],
  ] as const)('score %i → grade %s', (score, expected) => {
    expect(scoreToGrade(score)).toBe(expected);
  });
});
