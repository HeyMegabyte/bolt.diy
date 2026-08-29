/**
 * Stage 3.1 (core) — resolveFunctionsDispatch decision logic (ADR-0035 §30).
 *
 * Pure ordering: a reserved platform prefix → 'reserved'; else a non-reserved
 * /api/* with entitlement AND a deployed script → 'dispatch' to `site-<id>`;
 * else → 'passthrough' (static R2 / 404, never 403). `site_serving` consumes
 * this to decide whether to hand a child-host request to the site's WfP worker.
 * No env/DB — the entitlement + script-existence signals are inputs the caller
 * resolves (entitlement via getOrgEntitlements; hasDeployedScript via the deploy
 * signal Stage 2.2 records). Reuses the shared reserved-prefix + script-name SSOT.
 */
import { resolveFunctionsDispatch } from '../services/functions_dispatch.js';

const base = { siteId: 'abc', entitled: true, hasDeployedScript: true };

describe('resolveFunctionsDispatch', () => {
  it('passthrough for a non-/api path (static content is never dispatched)', () => {
    expect(resolveFunctionsDispatch({ ...base, pathname: '/about' }).action).toBe('passthrough');
    expect(resolveFunctionsDispatch({ ...base, pathname: '/' }).action).toBe('passthrough');
    expect(resolveFunctionsDispatch({ ...base, pathname: '/assets/app.js' }).action).toBe(
      'passthrough',
    );
  });

  it('reserved for every platform-reserved /api/* prefix — even when a user worker is deployed', () => {
    for (const pathname of [
      '/api/contact-form',
      '/api/contact-form/vitos',
      '/api/events',
      '/api/events/track',
      '/api/_ps',
      '/api/_ps/health',
    ]) {
      expect(resolveFunctionsDispatch({ ...base, pathname }).action).toBe('reserved');
    }
  });

  it('dispatch to site-<id> for a non-reserved /api/* when entitled + a script is deployed', () => {
    const d = resolveFunctionsDispatch({ ...base, pathname: '/api/quote' });
    expect(d.action).toBe('dispatch');
    if (d.action === 'dispatch') expect(d.scriptName).toBe('site-abc');
  });

  it('normalises the dispatch script name to the WfP-legal charset', () => {
    const d = resolveFunctionsDispatch({ ...base, siteId: 'AbC-123', pathname: '/api/quote' });
    expect(d.action).toBe('dispatch');
    if (d.action === 'dispatch') expect(d.scriptName).toBe('site-abc-123');
  });

  it('passthrough (404-territory, never 403) for a non-reserved /api/* when NOT entitled', () => {
    expect(
      resolveFunctionsDispatch({ ...base, entitled: false, pathname: '/api/quote' }).action,
    ).toBe('passthrough');
  });

  it('passthrough when entitled but no functions worker is deployed yet', () => {
    expect(
      resolveFunctionsDispatch({ ...base, hasDeployedScript: false, pathname: '/api/quote' }).action,
    ).toBe('passthrough');
  });

  it('substring-safe: /api/eventsy is NOT reserved (dispatches when entitled + deployed)', () => {
    expect(resolveFunctionsDispatch({ ...base, pathname: '/api/eventsy' }).action).toBe('dispatch');
  });
});
