/**
 * Unit tests for the url_clone_seed feature module.
 *
 * Uses Jest (not Vitest) per the project's test configuration.
 * External fetch calls are mocked — no real HTTP requests are made.
 */

import { CloneSeedBodySchema, CloneSeedResponseSchema } from '../schemas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake Env with Browser Rendering credentials. */
function makeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    CF_ACCOUNT_ID: 'test-account-id',
    CF_API_TOKEN: 'test-api-token',
    ...overrides,
  };
}

/** Minimal successful Browser Rendering API response. */
const successApiResponse = {
  success: true,
  errors: [],
  result: {
    html: '<html><head><title>Test Site</title><meta name="description" content="A test site."></head><body>Hello world</body></html>',
    text: 'Hello world',
  },
};

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe('CloneSeedBodySchema', () => {
  it('accepts a valid https url and siteId', () => {
    const result = CloneSeedBodySchema.safeParse({ url: 'https://example.com', siteId: 'site-001' });
    expect(result.success).toBe(true);
  });

  it('rejects http urls', () => {
    const result = CloneSeedBodySchema.safeParse({ url: 'http://example.com', siteId: 'site-001' });
    expect(result.success).toBe(false);
  });

  it('rejects missing siteId', () => {
    const result = CloneSeedBodySchema.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(false);
  });

  it('rejects non-url strings', () => {
    const result = CloneSeedBodySchema.safeParse({ url: 'not-a-url', siteId: 'site-001' });
    expect(result.success).toBe(false);
  });

  it('rejects empty siteId', () => {
    const result = CloneSeedBodySchema.safeParse({ url: 'https://example.com', siteId: '' });
    expect(result.success).toBe(false);
  });
});

describe('CloneSeedResponseSchema', () => {
  it('parses a valid success response', () => {
    const result = CloneSeedResponseSchema.safeParse({
      ok: true,
      data: {
        title: 'Test',
        description: 'A test',
        textLength: 10,
        extractedAt: new Date().toISOString(),
      },
    });
    expect(result.success).toBe(true);
  });

  it('parses a response without description', () => {
    const result = CloneSeedResponseSchema.safeParse({
      ok: true,
      data: {
        title: 'Test',
        textLength: 5,
        extractedAt: new Date().toISOString(),
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative textLength', () => {
    const result = CloneSeedResponseSchema.safeParse({
      ok: true,
      data: { title: 'T', textLength: -1, extractedAt: new Date().toISOString() },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Service tests
// ---------------------------------------------------------------------------

describe('cloneFromUrl', () => {
  let cloneFromUrl: (env: unknown, url: string) => Promise<unknown>;

  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function loadService() {
    const mod = await import('../service.js');
    cloneFromUrl = mod.cloneFromUrl as (env: unknown, url: string) => Promise<unknown>;
  }

  it('returns null when CF_ACCOUNT_ID is missing', async () => {
    await loadService();
    const result = await cloneFromUrl(makeEnv({ CF_ACCOUNT_ID: '' }), 'https://example.com');
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null when CF_API_TOKEN is missing', async () => {
    await loadService();
    const result = await cloneFromUrl(makeEnv({ CF_API_TOKEN: '' }), 'https://example.com');
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns extracted content on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => successApiResponse,
    });

    await loadService();
    const result = (await cloneFromUrl(makeEnv(), 'https://example.com')) as Record<string, unknown>;

    expect(result).not.toBeNull();
    expect(result['title']).toBe('Test Site');
    expect(result['description']).toBe('A test site.');
    expect(result['textContent']).toBe('Hello world');
  });

  it('returns null when the API responds with ok=false', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    });

    await loadService();
    const result = await cloneFromUrl(makeEnv(), 'https://example.com');
    expect(result).toBeNull();
  });

  it('returns null when success=false in the response body', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, errors: [{ message: 'unreachable host' }], result: null }),
    });

    await loadService();
    const result = await cloneFromUrl(makeEnv(), 'https://example.com');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network error'));

    await loadService();
    const result = await cloneFromUrl(makeEnv(), 'https://example.com');
    expect(result).toBeNull();
  });

  it('sends Authorization header with the API token', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => successApiResponse,
    });

    await loadService();
    await cloneFromUrl(makeEnv(), 'https://example.com');

    const [, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-api-token');
  });

  it('includes the target url in the request body', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => successApiResponse,
    });

    await loadService();
    await cloneFromUrl(makeEnv(), 'https://target.example.com');

    const [, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, string>;
    expect(body['url']).toBe('https://target.example.com');
  });

  it('extracts title from og:description when both tags exist', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        errors: [],
        result: {
          html: '<html><head><title>Page</title><meta property="og:description" content="OG desc"><meta name="description" content="Meta desc"></head><body>content</body></html>',
          text: 'content',
        },
      }),
    });

    await loadService();
    const result = (await cloneFromUrl(makeEnv(), 'https://example.com')) as Record<string, unknown>;
    // og:description should win over meta description
    expect(result['description']).toBe('OG desc');
  });
});

// ---------------------------------------------------------------------------
// FLAG_KEY export
// ---------------------------------------------------------------------------

describe('FLAG_KEY', () => {
  it('exports the expected flag key string', async () => {
    const { FLAG_KEY } = await import('../service.js');
    expect(FLAG_KEY).toBe('url_clone_seed');
  });
});
