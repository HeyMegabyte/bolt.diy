/**
 * Automation plane §13 — events./jobs. (self-hosted Inngest).
 *
 * Asserts the plane ships LIVE but safe-but-inert until the watched deploy binds
 * `INNGEST_CONTAINER`: the host routes + the SDK serve endpoint degrade to a 503
 * "provisioning" response (never a throw, never a 500) when the binding/secrets
 * are absent — mirroring the EventDispatcher graceful-degrade contract.
 */
import { inngestApp } from '../inngest/serve.js';
import { inngestFunctions, siteGenerationCompleted } from '../inngest/functions.js';
import type { Env } from '../types/env.js';

const emptyEnv = {} as Env;

describe('automation plane §13 — Inngest serve/routing', () => {
  it('jobs. host degrades to 503 provisioning without the container binding', async () => {
    const res = await inngestApp.request(
      'https://jobs.projectsites.dev/',
      { headers: { host: 'jobs.projectsites.dev' } },
      emptyEnv,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { plane: string; status: string };
    expect(body.plane).toBe('jobs');
    expect(body.status).toBe('provisioning');
  });

  it('events. host degrades to 503 provisioning without the container binding', async () => {
    const res = await inngestApp.request(
      'https://events.projectsites.dev/x',
      { headers: { host: 'events.projectsites.dev' } },
      emptyEnv,
    );
    expect(res.status).toBe(503);
  });

  it('proxies jobs. host to the InngestContainer DO when bound', async () => {
    let gotName = '';
    const fakeStub = { fetch: async () => new Response('inngest-dashboard', { status: 200 }) };
    const binding = {
      idFromName: (n: string) => {
        gotName = n;
        return { name: n } as unknown as DurableObjectId;
      },
      get: () => fakeStub,
    } as unknown as DurableObjectNamespace;
    const res = await inngestApp.request(
      'https://jobs.projectsites.dev/',
      { headers: { host: 'jobs.projectsites.dev' } },
      { INNGEST_CONTAINER: binding } as Env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('inngest-dashboard');
    expect(gotName).toBe('inngest-singleton'); // one warm singleton
  });

  it('/api/inngest serve endpoint degrades to 503 without a signing key', async () => {
    const res = await inngestApp.request(
      'https://projectsites.dev/api/inngest',
      { method: 'PUT', headers: { host: 'projectsites.dev' } },
      emptyEnv,
    );
    expect(res.status).toBe(503);
  });

  it('non-inngest host + non-serve path falls through (no 503 hijack)', async () => {
    const res = await inngestApp.request(
      'https://projectsites.dev/anything',
      { headers: { host: 'projectsites.dev' } },
      emptyEnv,
    );
    // inngestApp has no other route → 404 passthrough, NOT a 503.
    expect(res.status).toBe(404);
  });

  it('registers exactly the durable functions it serves', () => {
    expect(inngestFunctions).toContain(siteGenerationCompleted);
    expect(siteGenerationCompleted.id('projectsites')).toContain('site-generation-completed');
  });
});
