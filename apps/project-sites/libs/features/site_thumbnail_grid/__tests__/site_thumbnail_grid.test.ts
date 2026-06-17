/**
 * @module libs/features/site_thumbnail_grid/__tests__/site_thumbnail_grid
 * @description Unit tests for the site_thumbnail_grid feature module.
 */

// Mock dependencies BEFORE importing the module under test

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

// Import AFTER mocking
import { Hono } from 'hono';
import { siteThumbnailGrid } from '../handlers.js';

// R2 + env mock helpers
function makeMockR2(headResult: unknown = null) {
  return {
    head: jest.fn<() => Promise<unknown>>().mockResolvedValue(headResult),
    put: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    DB: {},
    SITES_BUCKET: makeMockR2(),
    ...overrides,
  } as never;
}

// Mount router + fire a request with the given env
async function request(
  method: string,
  path: string,
  opts: { userId?: string; env?: Record<string, unknown> } = {},
) {
  const env = makeEnv(opts.env ?? {});
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.userId) c.set('userId', opts.userId);
    c.env = env as never;
    await next();
  });
  app.route('/', siteThumbnailGrid);
  return { res: await app.request(path, { method }), env };
}

describe('site_thumbnail_grid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/sites/site1/thumbnail returns 404 when flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const { res } = await request('GET', '/api/sites/site1/thumbnail', { userId: 'user-1' });
    expect(res.status).toBe(404);
  });

  it('GET /api/sites/site1/thumbnail returns 401 when unauthenticated', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const { res } = await request('GET', '/api/sites/site1/thumbnail');
    expect(res.status).toBe(401);
  });

  it('returns thumbnailUrl with generated:false when R2 has existing object', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    // R2 head returns a non-null object — thumbnail already cached
    const mockHead = jest.fn<() => Promise<{ key: string }>>().mockResolvedValue({ key: 'thumbnails/site1.png' });
    const { res } = await request('GET', '/api/sites/site1/thumbnail', {
      userId: 'user-1',
      env: {
        SITES_BUCKET: {
          head: mockHead,
          put: jest.fn(),
        },
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; thumbnailUrl: string | null; generated: boolean };
    expect(json.ok).toBe(true);
    expect(json.thumbnailUrl).toBe('https://cdn.projectsites.dev/thumbnails/site1.png');
    expect(json.generated).toBe(false);
    expect(mockHead).toHaveBeenCalledWith('thumbnails/site1.png');
  });

  it('returns { thumbnailUrl: null, generated: false } when R2 is empty and no CF creds', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const mockHead = jest.fn<() => Promise<null>>().mockResolvedValue(null);
    const { res } = await request('GET', '/api/sites/site1/thumbnail', {
      userId: 'user-1',
      env: {
        SITES_BUCKET: {
          head: mockHead,
          put: jest.fn(),
        },
        CF_ACCOUNT_ID: undefined,
        CLOUDFLARE_API_TOKEN: undefined,
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; thumbnailUrl: null; generated: boolean };
    expect(json.ok).toBe(true);
    expect(json.thumbnailUrl).toBeNull();
    expect(json.generated).toBe(false);
  });
});
