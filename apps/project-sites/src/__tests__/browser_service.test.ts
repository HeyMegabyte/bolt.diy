/**
 * browser.projectsites.dev service — job validation + provider routing per route
 * (Cloudflare-first doctrine §5/§8). Execution is a later sub-slice.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { browserService, routeBrowserJob, BROWSER_PURPOSES } from '../routes/browser_service.js';

const CF = { BROWSER: {} } as Env;
const BOTH = { BROWSER: {}, BROWSERBASE_API_KEY: 'k', BROWSERBASE_PROJECT_ID: 'p' } as Env;

function app(env: Env) {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.route('/', browserService);
  return (path: string, body: unknown) =>
    a.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
}

const job = (over: Record<string, unknown> = {}) => ({ tenantId: 't', siteId: 's', ...over });

describe('routeBrowserJob — the LAW per job', () => {
  it('defaults to CF', () => {
    expect(routeBrowserJob('screenshot', job() as never, CF)).toMatchObject({ provider: 'cf', reason: 'cf-default', purpose: 'screenshot' });
  });
  it('maps backendPreference: browserbase + skyvern_internal', () => {
    expect(routeBrowserJob('qa', job({ backendPreference: 'browserbase' }) as never, BOTH).provider).toBe('browserbase');
    expect(routeBrowserJob('stagehand', job({ backendPreference: 'skyvern_internal' }) as never, BOTH).provider).toBe('skyvern_internal');
  });
  it('routes a specialty to Browserbase', () => {
    expect(routeBrowserJob('extract', job({ specialty: 'captcha' }) as never, BOTH).provider).toBe('browserbase');
  });
});

describe('POST /v1/browser/*', () => {
  it('exposes all nine purposes', () => {
    expect(BROWSER_PURPOSES).toHaveLength(9);
  });

  it('400s an invalid job (missing tenant/site, unknown field)', async () => {
    const req = app(CF);
    expect((await req('/v1/browser/screenshot', { siteId: 's' })).status).toBe(400);
    expect((await req('/v1/browser/screenshot', { tenantId: 't', siteId: 's', rogue: 1 })).status).toBe(400);
  });

  it('202s a non-executing job (qa) with the routed CF envelope', async () => {
    // screenshot/pdf execute on CF Browser Run (integration); qa returns the
    // routed envelope so this asserts routing without a live browser.
    const res = await app(CF)('/v1/browser/qa', job());
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: 'routed', provider: 'cf', purpose: 'qa' });
  });

  it('400s a screenshot job with no url/hostname target', async () => {
    const res = await app(CF)('/v1/browser/screenshot', job());
    expect(res.status).toBe(400);
  });

  it('503s when a requested backend is unavailable', async () => {
    // browserbase requested but no creds on CF-only env.
    const res = await app(CF)('/v1/browser/qa', job({ backendPreference: 'browserbase' }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('BROWSER_PROVIDER_UNAVAILABLE');
  });
});
