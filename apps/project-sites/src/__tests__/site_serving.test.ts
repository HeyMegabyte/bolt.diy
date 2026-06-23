import {
  generateTopBar,
  serveSiteFromR2,
  asyncifyRenderBlockingFonts,
} from '../services/site_serving';
import { DOMAINS, BRAND } from '@project-sites/shared';

describe('asyncifyRenderBlockingFonts', () => {
  const GF = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap';

  it('makes a render-blocking Google-Fonts stylesheet non-blocking', () => {
    const out = asyncifyRenderBlockingFonts(`<link href="${GF}" rel="stylesheet">`);
    expect(out).toContain('media="print"');
    expect(out).toContain(`onload="this.media='all'"`);
    expect(out).toContain(GF);
  });

  it('handles rel before href ordering', () => {
    const out = asyncifyRenderBlockingFonts(`<link rel="stylesheet" href="${GF}">`);
    expect(out).toContain('media="print"');
  });

  it('is idempotent — does not double-apply to an already-async link', () => {
    const once = asyncifyRenderBlockingFonts(`<link href="${GF}" rel="stylesheet">`);
    const twice = asyncifyRenderBlockingFonts(once);
    expect(twice).toBe(once);
    expect((twice.match(/media="print"/g) ?? []).length).toBe(1);
  });

  it('leaves non-Google-Fonts stylesheets render-blocking', () => {
    const link = '<link href="/assets/index-abc.css" rel="stylesheet">';
    expect(asyncifyRenderBlockingFonts(link)).toBe(link);
  });

  it('leaves a Google-Fonts preconnect/preload link untouched', () => {
    const pre = `<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>`;
    expect(asyncifyRenderBlockingFonts(pre)).toBe(pre);
  });

  it('transforms every blocking font link when multiple are present', () => {
    const a = 'https://fonts.googleapis.com/css2?family=Inter&display=swap';
    const b = 'https://fonts.googleapis.com/css2?family=Space+Grotesk&display=swap';
    const out = asyncifyRenderBlockingFonts(
      `<link href="${a}" rel="stylesheet"><link href="${b}" rel="stylesheet">`,
    );
    expect((out.match(/media="print"/g) ?? []).length).toBe(2);
  });
});

describe('generateTopBar', () => {
  it('generates valid HTML with CTA', () => {
    const html = generateTopBar('my-biz');
    expect(html).toContain('ps-bar');
    expect(html).toContain('Claim');
    expect(html).toContain('$50/mo');
  });

  it('includes edit link with slug', () => {
    const html = generateTopBar('joe-pizza');
    expect(html).toContain('slug=joe-pizza');
  });

  it('includes a dismiss button', () => {
    const html = generateTopBar('test');
    expect(html).toContain('&times;');
    expect(html).toContain('Dismiss');
  });

  it('has bar inner layout', () => {
    const html = generateTopBar('test');
    expect(html).toContain('ps-bar-inner');
  });

  it('links to the main domain', () => {
    const html = generateTopBar('test');
    expect(html).toContain(`https://${DOMAINS.SITES_BASE}`);
  });

  it('encodes slug in URL parameters to prevent XSS', () => {
    const html = generateTopBar('a"onmouseover="alert(1)');
    // The slug is encoded in the edit URL query parameter
    expect(html).toContain(encodeURIComponent('a"onmouseover="alert(1)'));
  });

  it('has correct z-index for overlay', () => {
    const html = generateTopBar('test');
    expect(html).toContain('z-index:99998');
  });

  it('is wrapped in HTML comments for identification', () => {
    const html = generateTopBar('test');
    expect(html).toContain('<!-- ProjectSites Conversion Flow v2 -->');
    expect(html).toContain('<!-- End ProjectSites Conversion Flow -->');
  });

  it('generates non-empty HTML for various slugs', () => {
    const slugs = ['a-b-c', 'my-business-123', 'test'];
    for (const slug of slugs) {
      const html = generateTopBar(slug);
      expect(html.length).toBeGreaterThan(100);
    }
  });

  it('uses fixed positioning at bottom', () => {
    const html = generateTopBar('test');
    expect(html).toContain('position:fixed');
    expect(html).toContain('bottom:0');
  });
});

describe('serveSiteFromR2', () => {
  function createMockEnv(files: Record<string, string> = {}) {
    return {
      SITES_BUCKET: {
        get: jest.fn(async (key: string) => {
          const content = files[key];
          if (!content) return null;
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(content));
              controller.close();
            },
          });
          return {
            body: stream,
            text: async () => content,
            key,
            httpMetadata: { contentType: 'text/html' },
            size: content.length,
          };
        }),
      },
      CACHE_KV: {
        get: jest.fn(async () => null),
        put: jest.fn(async () => {}),
        delete: jest.fn(async () => {}),
      },
    } as unknown as import('../types/env').Env;
  }

  const baseSite = {
    site_id: 'test-id',
    slug: 'my-biz',
    current_build_version: 'v1',
    plan: 'free',
  };

  it('returns text/html Content-Type for root path /', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/index.html': '<html><body>Hello</body></html>',
    });

    const response = await serveSiteFromR2(env, baseSite, '/');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  it('does NOT download root path as application/octet-stream', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/index.html': '<html><body>Test</body></html>',
    });

    const response = await serveSiteFromR2(env, baseSite, '/');
    expect(response.headers.get('Content-Type')).not.toBe('application/octet-stream');
  });

  it('returns text/css for .css files', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/style.css': 'body { color: red; }',
    });

    const response = await serveSiteFromR2(env, baseSite, '/style.css');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/css');
  });

  it('returns application/javascript for .js files', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/app.js': 'console.log("hello")',
    });

    const response = await serveSiteFromR2(env, baseSite, '/app.js');
    expect(response.headers.get('Content-Type')).toBe('application/javascript');
  });

  it('returns 404 for non-existent files', async () => {
    const env = createMockEnv({});

    const response = await serveSiteFromR2(env, baseSite, '/missing.txt');
    expect(response.status).toBe(404);
  });

  it('falls back to index.html for extensionless SPA routes', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/index.html': '<html><body>SPA</body></html>',
    });

    const response = await serveSiteFromR2(env, baseSite, '/about');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  it('injects top bar for free plan HTML', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/index.html': '<html><body>Content</body></html>',
    });

    const response = await serveSiteFromR2(env, baseSite, '/');
    const html = await response.text();
    expect(html).toContain('ps-bar');
    expect(html).toContain('ProjectSites');
  });

  it('does NOT inject top bar for paid plan HTML', async () => {
    const paidSite = { ...baseSite, plan: 'paid' };
    const env = createMockEnv({
      'sites/my-biz/v1/index.html': '<html><body>Content</body></html>',
    });

    const response = await serveSiteFromR2(env, paidSite, '/');
    const body = await response.text();
    expect(body).not.toContain('ps-bar');
  });

  it('blocks access to _meta/ paths', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/_meta/chat.json': '{}',
    });

    const response = await serveSiteFromR2(env, baseSite, '/_meta/chat.json');
    expect(response.status).toBe(404);
  });

  it('blocks access to _manifest.json', async () => {
    const env = createMockEnv({});

    const response = await serveSiteFromR2(env, baseSite, '/_manifest.json');
    expect(response.status).toBe(404);
  });

  it('sets caching headers', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/index.html': '<html><body>Cached</body></html>',
    });

    const response = await serveSiteFromR2(env, baseSite, '/');
    expect(response.headers.get('Cache-Control')).toContain('public');
    expect(response.headers.get('X-Site-Slug')).toBe('my-biz');
  });
});
