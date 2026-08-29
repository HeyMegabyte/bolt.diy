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
  siteFunctionsScriptName: (id: string) => `site-${id}`,
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

  // ── 5.2 Observability (ADR §13): invocations + errors → Traces / Log Explorer ──
  it('emits a tenant-tagged functions.invoke Trace event on a successful dispatch', async () => {
    mockHas.mockResolvedValue(true);
    mockEnt.mockResolvedValue({ customEndpoints: true });
    mockDispatch.mockResolvedValue(new Response('ok', { status: 201 }));
    await maybeDispatchFunctions(env, site, req('/api/quote'), '/api/quote');
    const ev = traceEvent('functions.invoke');
    expect(ev).toBeTruthy();
    expect(ev.siteId).toBe('abc');
    expect(ev.orgId).toBe('org1');
    expect(ev.scriptName).toBe('site-abc');
    expect(ev.path).toBe('/api/quote');
    expect(ev.status).toBe(201);
    expect(typeof ev.durationMs).toBe('number');
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
