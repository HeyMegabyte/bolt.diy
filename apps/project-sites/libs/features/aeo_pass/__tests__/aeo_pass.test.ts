/**
 * Unit + route-layer tests for the aeo_pass feature module.
 *
 * All external deps (D1, feature flags, R2) are mocked — no network/DB calls.
 * Covers the pure HTML analyzer (auditAeoHtml), the service
 * (runAeoAudit / getLatestAeoAudit reading published HTML from R2), and every
 * route (flag-off 404, no-auth 401, valid POST 200, GET with no data, GET after POST).
 */

import { Hono } from 'hono';

// ─── Mocks (must precede service/handler imports) ───────────────────────────

const mockDbInsert = jest.fn();
const mockDbQueryOne = jest.fn();
jest.mock('../../../../src/services/db.js', () => ({
  dbInsert: (...a: unknown[]) => mockDbInsert(...a),
  dbQuery: jest.fn(),
  dbQueryOne: (...a: unknown[]) => mockDbQueryOne(...a),
  dbExecute: jest.fn(),
}));

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

import { auditAeoHtml, runAeoAudit, getLatestAeoAudit } from '../service.js';
import { aeoPass } from '../handlers.js';

const mockBucketGet = jest.fn();
const env = {
  DB: {},
  SITES_BUCKET: { get: (...a: unknown[]) => mockBucketGet(...a) },
} as never;

/** A fully-optimized AEO page: FAQ schema, quotable lead, meta, one H1, sections, landmark. */
const RICH_HTML = `<!DOCTYPE html><html lang="en"><head>
<title>Best Soup Kitchen in Newark NJ — Free Hot Meals Daily</title>
<meta name="description" content="Newark's longest-running soup kitchen serves free hot meals seven days a week to anyone in need, no questions asked.">
<meta name="color-scheme" content="dark light">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"When are you open?","acceptedAnswer":{"@type":"Answer","text":"Daily 11am-2pm."}}]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Newark Soup Kitchen"}</script>
</head><body>
<main>
<h1>Free Hot Meals in Newark, Every Single Day</h1>
<p>We serve free, nourishing hot meals to anyone who walks through our doors, seven days a week, with dignity and zero paperwork.</p>
<h2>What We Serve</h2><p>Balanced plates with protein, vegetables, and dessert.</p>
<h2>How To Volunteer</h2><p>Sign up online and pick a shift.</p>
</main>
</body></html>`;

/** A bare page missing every AEO signal. */
const BARE_HTML = `<!DOCTYPE html><html><head></head><body><div>welcome</div></body></html>`;

/** Mount the handler under a parent app that optionally injects an authed user. */
function appWith(userId?: string): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (userId) c.set('userId' as never, userId as never);
    await next();
  });
  app.route('/', aeoPass);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbInsert.mockResolvedValue(undefined);
  // Default: a published site exists.
  mockDbQueryOne.mockResolvedValue({
    slug: 'newark-kitchen',
    current_build_version: 'v123',
    org_id: 'org_1',
  });
  mockBucketGet.mockResolvedValue({ text: async () => RICH_HTML });
  mockIsFlagOn.mockResolvedValue(true);
});

// ─── pure analyzer: auditAeoHtml ─────────────────────────────────────────────

describe('auditAeoHtml', () => {
  it('scores a fully-optimized page 100 with zero issues', () => {
    const { score, issues } = auditAeoHtml(RICH_HTML);
    expect(score).toBe(100);
    expect(issues).toEqual([]);
  });

  it('scores a bare page 0 and reports every missing signal', () => {
    const { score, issues } = auditAeoHtml(BARE_HTML);
    expect(score).toBe(0);
    expect(issues.length).toBeGreaterThanOrEqual(6);
    expect(issues.some((i) => /FAQ/i.test(i))).toBe(true);
    expect(issues.some((i) => /structured data/i.test(i))).toBe(true);
    expect(issues.some((i) => /quotable/i.test(i))).toBe(true);
    expect(issues.some((i) => /meta description/i.test(i))).toBe(true);
    expect(issues.some((i) => /H1/i.test(i))).toBe(true);
    expect(issues.some((i) => /title/i.test(i))).toBe(true);
  });

  it('flags a missing FAQ schema while crediting other structured data', () => {
    const html = RICH_HTML.replace(/"@type":"FAQPage"[\s\S]*?<\/script>/, '</script>');
    const { score, issues } = auditAeoHtml(html);
    expect(issues.some((i) => /FAQ/i.test(i))).toBe(true);
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThan(0);
  });

  it('flags multiple H1 headings as an issue', () => {
    const html = RICH_HTML.replace('</main>', '<h1>Second heading</h1></main>');
    const { issues } = auditAeoHtml(html);
    expect(issues.some((i) => /H1/i.test(i))).toBe(true);
  });

  it('clamps the score to the 0-100 range', () => {
    const r1 = auditAeoHtml(RICH_HTML);
    const r2 = auditAeoHtml(BARE_HTML);
    expect(r1.score).toBeGreaterThanOrEqual(0);
    expect(r1.score).toBeLessThanOrEqual(100);
    expect(r2.score).toBeGreaterThanOrEqual(0);
    expect(r2.score).toBeLessThanOrEqual(100);
  });
});

// ─── service: runAeoAudit ────────────────────────────────────────────────────

describe('runAeoAudit', () => {
  it('reads the published HTML from R2 and persists a real score', async () => {
    const result = await runAeoAudit(env, 'site_abc');

    expect(mockBucketGet).toHaveBeenCalledWith('sites/newark-kitchen/v123/index.html');
    expect(result.siteId).toBe('site_abc');
    expect(result.orgId).toBe('org_1');
    expect(result.score).toBe(100);
    expect(result.issues).toEqual([]);

    const [, table, row] = mockDbInsert.mock.calls[0] as [unknown, string, Record<string, unknown>];
    expect(table).toBe('aeo_audits');
    expect(row).toMatchObject({ site_id: 'site_abc', org_id: 'org_1', score: 100 });
  });

  it('returns real issues for a poorly-optimized published page', async () => {
    mockBucketGet.mockResolvedValue({ text: async () => BARE_HTML });
    const result = await runAeoAudit(env, 'site_bare');
    expect(result.score).toBe(0);
    expect(result.issues.length).toBeGreaterThanOrEqual(6);
  });

  it('returns score 0 with a clear issue when the site has no published version', async () => {
    mockDbQueryOne.mockResolvedValue({ slug: 'unbuilt', current_build_version: null, org_id: 'org_2' });
    const result = await runAeoAudit(env, 'site_unbuilt');
    expect(result.score).toBe(0);
    expect(result.issues[0]).toMatch(/publish/i);
    expect(mockBucketGet).not.toHaveBeenCalled();
  });

  it('returns score 0 with a clear issue when the R2 object is missing', async () => {
    mockBucketGet.mockResolvedValue(null);
    const result = await runAeoAudit(env, 'site_missing');
    expect(result.score).toBe(0);
    expect(result.issues[0]).toMatch(/not found|re-publish/i);
  });
});

// ─── service: getLatestAeoAudit ──────────────────────────────────────────────

describe('getLatestAeoAudit', () => {
  it('returns null when no audit exists', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const result = await getLatestAeoAudit(env, 'site_xyz');
    expect(result).toBeNull();
  });

  it('maps the D1 row to a typed AeoAudit', async () => {
    mockDbQueryOne.mockResolvedValue({
      id: 'audit_1',
      site_id: 'site_xyz',
      org_id: null,
      score: 84,
      issues: JSON.stringify(['Missing FAQ schema']),
      created_at: '2026-06-17T00:00:00.000Z',
    });

    const result = await getLatestAeoAudit(env, 'site_xyz');
    expect(result).toMatchObject({
      id: 'audit_1',
      siteId: 'site_xyz',
      score: 84,
      issues: ['Missing FAQ schema'],
    });
  });
});

// ─── POST /api/aeo/audit/:siteId ─────────────────────────────────────────────

describe('POST /api/aeo/audit/:siteId', () => {
  it('returns 404 when the flag is off (no leak)', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await appWith('user_1').request('/api/aeo/audit/site_abc', { method: 'POST' }, env);
    expect(res.status).toBe(404);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('returns 401 when not authenticated', async () => {
    const res = await appWith().request('/api/aeo/audit/site_abc', { method: 'POST' }, env);
    expect(res.status).toBe(401);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('returns 200 with a real audit object for an authed request', async () => {
    const res = await appWith('user_1').request('/api/aeo/audit/site_abc', { method: 'POST' }, env);
    expect(res.status).toBe(200);

    const json = (await res.json()) as { ok: boolean; audit: { siteId: string; score: number; issues: string[] } };
    expect(json.ok).toBe(true);
    expect(json.audit.siteId).toBe('site_abc');
    expect(json.audit.score).toBe(100);
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });
});

// ─── GET /api/aeo/:siteId ────────────────────────────────────────────────────

describe('GET /api/aeo/:siteId', () => {
  it('returns 404 when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await appWith('user_1').request('/api/aeo/site_abc', {}, env);
    expect(res.status).toBe(404);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await appWith().request('/api/aeo/site_abc', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns { ok: true, audit: null } when no audit exists', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const res = await appWith('user_1').request('/api/aeo/site_abc', {}, env);
    expect(res.status).toBe(200);

    const json = (await res.json()) as { ok: boolean; audit: null };
    expect(json.ok).toBe(true);
    expect(json.audit).toBeNull();
  });

  it('returns the latest audit when one exists', async () => {
    mockDbQueryOne.mockResolvedValue({
      id: 'audit_1',
      site_id: 'site_abc',
      org_id: null,
      score: 84,
      issues: JSON.stringify(['Missing FAQ schema']),
      created_at: '2026-06-17T00:00:00.000Z',
    });

    const res = await appWith('user_1').request('/api/aeo/site_abc', {}, env);
    expect(res.status).toBe(200);

    const json = (await res.json()) as { ok: boolean; audit: { id: string; score: number } };
    expect(json.ok).toBe(true);
    expect(json.audit.id).toBe('audit_1');
    expect(json.audit.score).toBe(84);
  });
});
