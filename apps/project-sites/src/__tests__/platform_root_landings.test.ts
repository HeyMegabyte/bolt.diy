/**
 * GET / landing-page coverage for the platform / system / LLM-gateway subdomains
 * served by the worker root handler (`src/index.ts` `app.get('/')`).
 *
 * Regression guard for the iter-47 consolidation of the TWO `app.get('/')`
 * handlers into one. Prod ground truth (iter 47): `llm`, `logs`, `webhooks`,
 * `links` roots all serve 200 landing pages via the SECOND handler — the earlier
 * "the 2nd GET / is moot, delete it" analysis was WRONG (deleting it would 404
 * those four hosts). This test locks the served landings so the merge that keeps
 * ONE handler cannot silently regress them.
 *
 * Exercises the real worker fetch handler end-to-end; only the R2 boundary
 * (SITES_BUCKET) is stubbed (these hosts never touch it).
 */

jest.mock('@cloudflare/containers', () => ({
  Container: class {},
  ContainerProxy: class {},
  outboundParams: () => ({}),
}));

jest.mock('cloudflare:workers', () => ({ DurableObject: class {}, WorkflowEntrypoint: class {} }), {
  virtual: true,
});

import worker from '../index.js';

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    SITES_BUCKET: { get: async () => null },
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
    SENTRY_DSN: 'https://x@o0.ingest.sentry.io/0',
    SENTRY_RELEASE: 'project-sites@test',
    ...overrides,
  } as never;
}

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as never;

const serveRoot = (host: string) =>
  (worker as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(
    new Request(`https://${host}/`, { headers: { host } }),
    makeEnv(),
    ctx,
  );

describe('GET / — LLM-gateway subdomain landing', () => {
  it('llm.projectsites.dev/ → 200 with the LLM Gateway landing', async () => {
    const res = await serveRoot('llm.projectsites.dev');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('LLM Gateway');
  });
});

describe('GET / — platform-service subdomain landings (2nd handler — must not regress)', () => {
  it('logs.projectsites.dev/ → 200 with the Logs landing', async () => {
    const res = await serveRoot('logs.projectsites.dev');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Logs — ProjectSites');
  });

  it('webhooks.projectsites.dev/ → 200 with the Webhooks landing', async () => {
    const res = await serveRoot('webhooks.projectsites.dev');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Webhooks — ProjectSites');
  });

  it('links.projectsites.dev/ → 200 with the Links landing', async () => {
    const res = await serveRoot('links.projectsites.dev');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Links — ProjectSites');
  });
});

// NOTE: the system-service path (resolveSystemService → systemServiceLanding, e.g.
// api.projectsites.dev) is unit-covered by system_service_landing.test.ts and is
// NOT a regression surface for the merge (the consolidated handler keeps the exact
// same resolveSystemService branch that the first handler already ran). It is
// intentionally not exercised here — routing it through the full worker in the test
// env hits binding-dependent middleware unrelated to the landing logic.
