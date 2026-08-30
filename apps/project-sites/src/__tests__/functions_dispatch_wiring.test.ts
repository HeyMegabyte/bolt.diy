/**
 * Stage 3.1 (wiring) — maybeDispatchFunctions, the impure orchestrator the
 * site_serving catch-all calls. Composes the entitlement + deployed-script
 * signals with the pure resolveFunctionsDispatch decision, then dispatches to
 * the site's WfP worker. Fail-soft: any error (or a non-dispatch decision)
 * returns null so static serving continues. Deps mocked; this locks the hot-path
 * gating (cheap checks first, no D1 read for non-candidates) + fail-soft.
 */
jest.mock('../services/functions_deploy.js', () => ({ siteHasDeployedFunctions: jest.fn() }));
jest.mock('../services/billing.js', () => ({ getOrgEntitlements: jest.fn() }));
jest.mock('../services/wfp_dispatch.js', () => ({
  siteFunctionsScriptName: (id: string, opts?: { preview?: boolean }) =>
    opts?.preview ? `site-${id}-preview` : `site-${id}`,
  dispatchToUserWorker: jest.fn(),
}));

import { maybeDispatchFunctions } from '../services/functions_dispatch.js';
import { siteHasDeployedFunctions } from '../services/functions_deploy.js';
import { getOrgEntitlements } from '../services/billing.js';
import { dispatchToUserWorker } from '../services/wfp_dispatch.js';
import type { Env } from '../types/env.js';

const mockHas = siteHasDeployedFunctions as unknown as jest.Mock;
const mockEnt = getOrgEntitlements as unknown as jest.Mock;
const mockDispatch = dispatchToUserWorker as unknown as jest.Mock;

const env = { DB: {} } as unknown as Env;
const site = { siteId: 'abc', orgId: 'org1' };
const req = (p = '/api/quote') => new Request(`https://abc.projectsites.dev${p}`);

let warnLogs: string[];
beforeEach(() => {
  mockHas.mockReset();
  mockEnt.mockReset();
  mockDispatch.mockReset();
  warnLogs = [];
  jest.spyOn(console, 'warn').mockImplementation((m?: unknown) => {
    warnLogs.push(String(m));
  });
});
afterEach(() => jest.restoreAllMocks());

/** Parse the captured structured Trace events + find one by `msg`. */
const traceEvent = (msg: string) =>
  warnLogs
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return {};
      }
    })
    .find((o) => o.msg === msg);

describe('maybeDispatchFunctions', () => {
  it('returns null (no D1 read) for a non-/api path — static content', async () => {
    expect(await maybeDispatchFunctions(env, site, req('/about'), '/about')).toBeNull();
    expect(mockHas).not.toHaveBeenCalled();
  });

  it('returns null (no D1 read) for a reserved /api path — the platform owns it', async () => {
    expect(await maybeDispatchFunctions(env, site, req(), '/api/contact-form/abc')).toBeNull();
    expect(await maybeDispatchFunctions(env, site, req(), '/api/_ps/health')).toBeNull();
    expect(mockHas).not.toHaveBeenCalled();
  });

  it('returns null + skips the entitlement read when no functions worker is deployed', async () => {
    mockHas.mockResolvedValue(false);
    expect(await maybeDispatchFunctions(env, site, req(), '/api/quote')).toBeNull();
    expect(mockEnt).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('dispatches to site-<id> (returns the worker Response) when deployed + entitled', async () => {
    mockHas.mockResolvedValue(true);
    mockEnt.mockResolvedValue({ customEndpoints: true });
    mockDispatch.mockResolvedValue(new Response('fn-ok', { status: 200 }));
    const r = req();
    const res = await maybeDispatchFunctions(env, site, r, '/api/quote');
    expect(res).not.toBeNull();
    expect(await res!.text()).toBe('fn-ok');
    expect(mockDispatch).toHaveBeenCalledWith(env, 'site-abc', r);
  });

  // ── Stage 2.3 preview slot (`?_ps_preview=1`) ──
  it('preview (?_ps_preview=1): dispatches to site-<id>-preview, SKIPPING the live deploy-signal gate', async () => {
    // The LIVE signal is false — a preview must still dispatch (the owner is
    // testing an as-yet-unpromoted bundle), so the gate is skipped entirely.
    mockHas.mockResolvedValue(false);
    mockEnt.mockResolvedValue({ customEndpoints: true });
    mockDispatch.mockResolvedValue(new Response('preview-ok', { status: 200 }));
    const r = new Request('https://abc.projectsites.dev/api/quote?_ps_preview=1');
    const res = await maybeDispatchFunctions(env, site, r, '/api/quote');
    expect(res).not.toBeNull();
    expect(await res!.text()).toBe('preview-ok');
    expect(mockHas).not.toHaveBeenCalled(); // live gate skipped in preview mode
    expect(mockDispatch).toHaveBeenCalledWith(env, 'site-abc-preview', r);
  });

  it('preview still respects the entitlement gate (not entitled → null passthrough)', async () => {
    mockEnt.mockResolvedValue({ customEndpoints: false });
    const r = new Request('https://abc.projectsites.dev/api/quote?_ps_preview=1');
    expect(await maybeDispatchFunctions(env, site, r, '/api/quote')).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // ── 5.2 Observability (ADR §13): invocations + errors → Traces / Log Explorer ──
  // Field names MUST match logs_explorer.mapEvent (msg/method/path/status/durationMs/
  // requestId + ISO ts + eventName alias) so the row renders in /admin/logs.
  it('emits a functions.invoke event matching the Log Explorer mapEvent schema', async () => {
    mockHas.mockResolvedValue(true);
    mockEnt.mockResolvedValue({ customEndpoints: true });
    mockDispatch.mockResolvedValue(new Response('ok', { status: 201 }));
    const r = new Request('https://abc.projectsites.dev/api/quote', {
      headers: { 'cf-ray': 'ray-abc-123' },
    });
    await maybeDispatchFunctions(env, site, r, '/api/quote');
    const ev = traceEvent('functions.invoke');
    expect(ev).toBeTruthy();
    // meta (per-site filtering)
    expect(ev.siteId).toBe('abc');
    expect(ev.orgId).toBe('org1');
    // mapEvent-read fields
    expect(ev.method).toBe('GET');
    expect(ev.path).toBe('/api/quote');
    expect(ev.status).toBe(201);
    expect(typeof ev.durationMs).toBe('number');
    expect(ev.requestId).toBe('ray-abc-123'); // was `cfRay` (ignored by mapEvent) — now `requestId`
    expect(ev.level).toBe('info');
    expect(ev.eventName).toBe('functions.invoke'); // canonical-logger alias
    expect(typeof ev.ts).toBe('string'); // ISO, not an epoch number
  });

  it('logs functions.dispatch_error instead of silently swallowing (still fail-soft null)', async () => {
    mockHas.mockResolvedValue(true);
    mockEnt.mockResolvedValue({ customEndpoints: true });
    mockDispatch.mockRejectedValue(new Error('WfP boom'));
    const res = await maybeDispatchFunctions(env, site, req(), '/api/quote');
    expect(res).toBeNull();
    const ev = traceEvent('functions.dispatch_error');
    expect(ev).toBeTruthy();
    expect(ev.siteId).toBe('abc');
    expect(ev.error).toContain('WfP boom');
  });

  it('emits NO invoke Trace on passthrough (no deployed script)', async () => {
    mockHas.mockResolvedValue(false);
    await maybeDispatchFunctions(env, site, req(), '/api/quote');
    expect(traceEvent('functions.invoke')).toBeFalsy();
    expect(traceEvent('functions.dispatch_error')).toBeFalsy();
  });

  it('returns null (passthrough, never 403) when deployed but NOT entitled', async () => {
    mockHas.mockResolvedValue(true);
    mockEnt.mockResolvedValue({ customEndpoints: false });
    expect(await maybeDispatchFunctions(env, site, req(), '/api/quote')).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('fail-soft → null when dispatch throws (never breaks static serving)', async () => {
    mockHas.mockResolvedValue(true);
    mockEnt.mockResolvedValue({ customEndpoints: true });
    mockDispatch.mockRejectedValue(new Error('WfP down'));
    expect(await maybeDispatchFunctions(env, site, req(), '/api/quote')).toBeNull();
  });

  it('fail-soft → null when the deployed-script D1 read throws', async () => {
    mockHas.mockRejectedValue(new Error('D1 down'));
    expect(await maybeDispatchFunctions(env, site, req(), '/api/quote')).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// ── Stage 4.2 — default dispatch guardrails (body cap 413, per-IP rate-limit 429) ──
describe('maybeDispatchFunctions guardrails', () => {
  /** An entitled + deployed site, so every request reaches the guardrails. */
  function entitledDeployed() {
    mockHas.mockResolvedValue(true);
    mockEnt.mockResolvedValue({ customEndpoints: true });
    mockDispatch.mockResolvedValue(new Response('fn-ok', { status: 200 }));
  }
  const bigBodyReq = () =>
    new Request('https://abc.projectsites.dev/api/upload', {
      headers: new Headers({ 'content-length': String(26 * 1024 * 1024) }),
    });
  const limiterEnv = (success: boolean) =>
    ({
      DB: {},
      FUNCTIONS_RATELIMIT: { limit: jest.fn(async () => ({ success })) },
    }) as unknown as Env;

  it('413 (no dispatch) when the body exceeds the 25 MB cap + emits functions.rejected', async () => {
    entitledDeployed();
    const res = await maybeDispatchFunctions(env, site, bigBodyReq(), '/api/upload');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(413);
    expect(await res!.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the 25 MB limit.' },
    });
    expect(mockDispatch).not.toHaveBeenCalled();
    const ev = traceEvent('functions.rejected');
    expect(ev?.reason).toBe('body_too_large');
    expect(ev?.status).toBe(413);
  });

  it('429 (no dispatch) when the per-IP rate-limit is exceeded + Retry-After + functions.rejected', async () => {
    entitledDeployed();
    const rlEnv = limiterEnv(false);
    const r = new Request('https://abc.projectsites.dev/api/quote', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    });
    const res = await maybeDispatchFunctions(rlEnv, site, r, '/api/quote');
    expect(res!.status).toBe(429);
    expect(res!.headers.get('retry-after')).toBe('10');
    expect(mockDispatch).not.toHaveBeenCalled();
    // limiter keyed <siteId>:<ip>
    const limiter = (rlEnv as unknown as { FUNCTIONS_RATELIMIT: { limit: jest.Mock } })
      .FUNCTIONS_RATELIMIT;
    expect(limiter.limit).toHaveBeenCalledWith({ key: 'abc:203.0.113.7' });
    expect(traceEvent('functions.rejected')?.reason).toBe('rate_limited');
  });

  it('dispatches normally when the rate-limit passes', async () => {
    entitledDeployed();
    const rlEnv = limiterEnv(true);
    const res = await maybeDispatchFunctions(rlEnv, site, req(), '/api/quote');
    expect(res).not.toBeNull();
    expect(await res!.text()).toBe('fn-ok');
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('fails OPEN (dispatches) when no rate-limit binding is present (dev/local)', async () => {
    entitledDeployed();
    const res = await maybeDispatchFunctions(env, site, req(), '/api/quote');
    expect(res).not.toBeNull();
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('guardrails run ONLY on an actual dispatch — a not-entitled big body just passes through', async () => {
    mockHas.mockResolvedValue(true);
    mockEnt.mockResolvedValue({ customEndpoints: false });
    expect(await maybeDispatchFunctions(env, site, bigBodyReq(), '/api/upload')).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
