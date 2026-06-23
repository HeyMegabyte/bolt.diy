import {
  generateTopBar,
  serveSiteFromR2,
  asyncifyRenderBlockingFonts,
  injectAppShellHero,
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

describe('injectAppShellHero', () => {
  const ROOT = '<div id="root"></div>';
  const page = (head: string, body = ROOT) =>
    `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

  it('injects a static hero into an empty #root from og:title + description', () => {
    const out = injectAppShellHero(
      page(
        '<meta property="og:title" content="Where Makers Build the Future"><meta name="description" content="We ship gorgeous software.">',
      ),
    );
    expect(out).toContain('data-app-shell="hero"');
    expect(out).toContain('<h1');
    expect(out).toContain('Where Makers Build the Future');
    expect(out).toContain('We ship gorgeous software.');
    // root is no longer empty
    expect(out).not.toContain('<div id="root"></div>');
  });

  it('falls back to <title> first segment when og:title is absent', () => {
    const out = injectAppShellHero(page('<title>Acme Bakery | Fresh bread daily</title>'));
    expect(out).toContain('>Acme Bakery</h1>');
    expect(out).not.toContain('Fresh bread daily</h1>'); // brand tail stripped
  });

  it('drives background from theme-color and picks readable text (light theme → dark text)', () => {
    const out = injectAppShellHero(
      page('<meta name="theme-color" content="#ffffff"><title>Lone Mountain</title>'),
    );
    expect(out).toContain('background:#ffffff');
    expect(out).toContain('color:#0b0b0f'); // dark text on a light theme
  });

  it('uses light text on a dark theme-color', () => {
    const out = injectAppShellHero(
      page('<meta name="theme-color" content="#0a0a0f"><title>Night Co</title>'),
    );
    expect(out).toContain('color:#f5f5f7');
  });

  it('rejects a non-hex theme-color (style-injection guard) and uses the default bg', () => {
    const out = injectAppShellHero(
      page('<meta name="theme-color" content="red;}body{display:none"><title>Evil</title>'),
    );
    expect(out).toContain('background:#0a0a0f');
    // The raw value never reaches the injected hero's style (only the inert head meta keeps it).
    expect(out).not.toContain('background:red');
  });

  it('escapes HTML in the headline (XSS guard)', () => {
    const out = injectAppShellHero(page('<title>&lt;img src=x onerror=alert(1)&gt; Co</title>'));
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt; Co');
  });

  it('is a no-op when #root already has content', () => {
    const populated = page(
      '<title>Has Content</title>',
      '<div id="root"><nav>real app</nav></div>',
    );
    expect(injectAppShellHero(populated)).toBe(populated);
  });

  it('is a no-op when there is no #root', () => {
    const noRoot =
      '<!DOCTYPE html><html><head><title>X</title></head><body><main>static</main></body></html>';
    expect(injectAppShellHero(noRoot)).toBe(noRoot);
  });

  it('is a no-op when no headline can be derived', () => {
    const out = injectAppShellHero('<html><head></head><body><div id="root"></div></body></html>');
    expect(out).toContain('<div id="root"></div>'); // unchanged
  });
});
