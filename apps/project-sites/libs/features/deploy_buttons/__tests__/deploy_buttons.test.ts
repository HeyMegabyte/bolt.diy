/**
 * Tests for the deploy_buttons feature module.
 * Covers: service unit tests, flag-off 404, no-orgId 401,
 * site-not-found 404, and happy-path 200 with snippet validation.
 */
import { Hono } from 'hono';

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

const mockDbQueryOne = jest.fn();
jest.mock('../../../../src/services/db.js', () => ({
  dbQueryOne: (...a: unknown[]) => mockDbQueryOne(...a),
  dbQuery: jest.fn().mockResolvedValue({ data: [] }),
  dbInsert: jest.fn().mockResolvedValue({}),
  dbExecute: jest.fn().mockResolvedValue(undefined),
}));

import { generateDeploySnippets, FLAG_KEY } from '../service.js';
import { deployButtons } from '../handlers.js';

// ---------------------------------------------------------------------------
// App factory — mounts deployButtons at /api/deploy-buttons matching src/index
// ---------------------------------------------------------------------------
function app(orgId: string | null = null) {
  const a = new Hono();
  // Simulate auth middleware setting orgId
  a.use('*', async (c, next) => {
    if (orgId !== null) (c as unknown as { set: (k: string, v: string) => void }).set('orgId', orgId);
    await next();
  });
  a.route('/api/deploy-buttons', deployButtons);
  return a;
}

const GET = (siteId: string, qs = '', orgId: string | null = 'org-123') =>
  app(orgId).request(
    `/api/deploy-buttons/${siteId}${qs ? `?${qs}` : ''}`,
    { method: 'GET' },
    {} as never,
    { waitUntil() {}, passThroughOnException() {} } as never,
  );

const SITE = {
  id: 'site-001',
  slug: 'acme',
  business_name: 'Acme Corp',
  primary_hostname: null,
};

beforeEach(() => {
  mockIsFlagOn.mockReset();
  mockDbQueryOne.mockReset();
});

// ---------------------------------------------------------------------------
// 1. Service unit tests
// ---------------------------------------------------------------------------
describe('generateDeploySnippets()', () => {
  const site = { id: 'site-001', slug: 'acme', business_name: 'Acme Corp', url: 'https://acme.projectsites.dev' };

  it('returns all required fields', () => {
    const result = generateDeploySnippets(site, { style: 'flat' });
    expect(result.site_id).toBe(site.id);
    expect(result.slug).toBe(site.slug);
    expect(result.url).toBe(site.url);
    expect(result.markdown_badge).toContain('img.shields.io');
    expect(result.html_badge).toContain('<a href');
    expect(result.markdown_deploy_button).toContain('Deploy to projectsites.dev');
    expect(result.html_deploy_button).toContain('<img');
  });

  it('applies the requested badge style', () => {
    const result = generateDeploySnippets(site, { style: 'for-the-badge' });
    expect(result.markdown_badge).toContain('for-the-badge');
    expect(result.markdown_deploy_button).toContain('for-the-badge');
  });

  it('applies a custom label when provided', () => {
    const result = generateDeploySnippets(site, { style: 'flat', label: 'live on' });
    expect(result.markdown_badge).toContain('live_on');
  });

  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('deploy_buttons');
  });
});

// ---------------------------------------------------------------------------
// 2. Flag off → 404
// ---------------------------------------------------------------------------
describe('GET /api/deploy-buttons/:siteId — flag gate', () => {
  it('returns 404 when the deploy_buttons flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await GET('site-001');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// 3. No orgId → 401
// ---------------------------------------------------------------------------
describe('GET /api/deploy-buttons/:siteId — auth', () => {
  it('returns 401 when no orgId is present', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET('site-001', '', null); // orgId = null → middleware skips set
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// 4. Site not found → 404
// ---------------------------------------------------------------------------
describe('GET /api/deploy-buttons/:siteId — ownership', () => {
  it('returns 404 when the site does not exist or does not belong to the org', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockDbQueryOne.mockResolvedValue(null);
    const res = await GET('non-existent-site-id');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// 5. Happy path → 200 with all snippet fields
// ---------------------------------------------------------------------------
describe('GET /api/deploy-buttons/:siteId — happy path', () => {
  it('returns 200 with badge + deploy-button snippets', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockDbQueryOne.mockResolvedValue(SITE);

    const res = await GET(SITE.id, 'style=flat-square');
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, string>;
    expect(body.site_id).toBe(SITE.id);
    expect(body.slug).toBe(SITE.slug);
    expect(body.url).toBe('https://acme.projectsites.dev');
    expect(body.markdown_badge).toContain('img.shields.io');
    expect(body.html_badge).toContain('<a href');
    expect(body.markdown_deploy_button).toContain('Deploy to projectsites.dev');
    expect(body.html_deploy_button).toContain('<img');
    // Style param is forwarded
    expect(body.markdown_badge).toContain('flat-square');
  });
});
