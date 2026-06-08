/**
 * Marketing-HTML serve path coverage for three LIVE published-site-quality flags
 * that inject into every `projectsites.dev` marketing response (src/index.ts
 * `app.all('*')`), but previously had ZERO test coverage:
 *
 *   - speculation_rules        → <script type="speculationrules"> (prerender + prefetch)
 *   - structured_data_autopilot → per-route Organization + WebSite + WebPage + BreadcrumbList JSON-LD
 *   - quotable_answer_block     → sr-only <div data-quotable> 40-60 word AI-search lead
 *
 * Exercises the real worker fetch handler end-to-end, mocking only the R2
 * boundary (SITES_BUCKET). Asserts: the three injections land in served HTML,
 * the structured data is ROUTE-ACCURATE (not hardcoded to the homepage),
 * non-HTML assets are NOT mutated, and a missing marketing asset degrades to the
 * JSON info fallback.
 */

// `@cloudflare/containers` ships ESM-only (untransformed by ts-jest) and is
// pulled in transitively via the Durable Object container classes when the full
// worker entry is imported. Stub it to a constructable shape so `../index`
// loads — the marketing serve path under test never touches containers.
jest.mock('@cloudflare/containers', () => ({
  Container: class {},
  ContainerProxy: class {},
  outboundParams: () => ({}),
}));

// `cloudflare:workers` is a runtime-only virtual module (DurableObject +
// WorkflowEntrypoint base classes) with no npm package to resolve under Jest.
jest.mock(
  'cloudflare:workers',
  () => ({ DurableObject: class {}, WorkflowEntrypoint: class {} }),
  { virtual: true },
);

import worker from '../index.js';

// Minimal R2-object stub for the marketing HTML shell.
const htmlShell = '<!doctype html><html><head></head><body></body></html>';
const htmlAsset = (body = htmlShell) => ({ key: 'marketing/index.html', text: async () => body });

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    SITES_BUCKET: {
      get: async (key: string) => (key === 'marketing/index.html' ? htmlAsset() : null),
    },
    // EnvSchema (src/lib/env.ts) required fields — parseEnv() runs as the first
    // middleware and 400s the request if any are missing.
    POSTHOG_API_KEY: 'ph_test',
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_PUBLISHABLE_KEY: 'pk_test',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    CF_API_TOKEN: 'cf_test',
    CF_ZONE_ID: 'zone_test',
    GOOGLE_CLIENT_ID: 'gid_test',
    GOOGLE_CLIENT_SECRET: 'gsecret_test',
    GOOGLE_PLACES_API_KEY: 'places_test',
    ENVIRONMENT: 'test',
    SENTRY_DSN: '',
    SENTRY_RELEASE: 'project-sites@test',
    ...overrides,
  } as never;
}

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as never;

const serve = (path: string, env: ReturnType<typeof makeEnv> = makeEnv()) =>
  (worker as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(
    new Request(`https://projectsites.dev${path}`, { headers: { host: 'projectsites.dev' } }),
    env,
    ctx,
  );

describe('marketing serve — speculation_rules injection', () => {
  it('injects the speculationrules script with prerender + prefetch rules', async () => {
    const html = await (await serve('/')).text();
    expect(html).toContain('<script type="speculationrules">');
    expect(html).toContain('"prerender"');
    expect(html).toContain('"prefetch"');
    // admin + api are excluded from prerender (don't prefetch authed/mutating routes)
    expect(html).toContain('/admin/*');
    expect(html).toContain('/api/*');
  });

  it('sets the Link: rel="prerender" response hint', async () => {
    const res = await serve('/');
    expect(res.headers.get('Link')).toContain('rel="prerender"');
  });
});

describe('marketing serve — structured_data_autopilot injection', () => {
  it('emits Organization + WebSite + WebPage + BreadcrumbList JSON-LD on the homepage', async () => {
    const html = await (await serve('/')).text();
    expect(html).toContain('application/ld+json');
    for (const t of ['"Organization"', '"WebSite"', '"WebPage"', '"BreadcrumbList"', '"SearchAction"']) {
      expect(html).toContain(t);
    }
  });

  it('is ROUTE-ACCURATE — a sub-route gets its own WebPage url + breadcrumb (not hardcoded home)', async () => {
    const html = await (await serve('/pricing')).text();
    // per-route WebPage @id + url reflect the requested path
    expect(html).toContain('https://projectsites.dev/pricing#webpage');
    expect(html).toContain('"url":"https://projectsites.dev/pricing"');
    // breadcrumb trail derives a human name from the slug
    expect(html).toContain('"name":"Pricing"');
    // and still chains back to Home
    expect(html).toContain('https://projectsites.dev/');
  });
});

describe('marketing serve — quotable_answer_block injection', () => {
  it('injects an sr-only data-quotable lead paragraph after <body>', async () => {
    const html = await (await serve('/')).text();
    expect(html).toContain('data-quotable');
    expect(html).toContain('under 15 minutes');
    // sr-only / visually-hidden so it serves crawlers + AT without visual noise
    expect(html).toMatch(/data-quotable[^>]*clip:rect\(0 0 0 0\)/);
  });

  it('also injects the runtime env meta tags (posthog + stripe pk)', async () => {
    const html = await (await serve('/')).text();
    expect(html).toContain('content="ph_test"');
    expect(html).toContain('content="pk_test"');
  });
});

describe('marketing serve — guardrails', () => {
  it('does NOT inject into non-HTML marketing assets', async () => {
    const env = makeEnv({
      SITES_BUCKET: {
        get: async (key: string) =>
          key === 'marketing/robots.txt'
            ? { key: 'marketing/robots.txt', text: async () => 'User-agent: *\nAllow: /' }
            : null,
      },
    });
    const res = await serve('/robots.txt', env);
    const body = await res.text();
    expect(body).not.toContain('speculationrules');
    expect(body).not.toContain('data-quotable');
    expect(res.headers.get('Content-Type')).toContain('text/plain');
  });

  it('degrades to the JSON info fallback when no marketing asset is deployed', async () => {
    const env = makeEnv({ SITES_BUCKET: { get: async () => null } });
    const res = await serve('/', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { name: string };
    expect(json.name).toBe('Project Sites');
  });
});
