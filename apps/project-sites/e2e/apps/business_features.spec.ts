/**
 * @module e2e/apps/business_features
 * @description Convergence E2E — business feature routes (booking, crm, portal, white_label, ab_testing, visual_automation, app_launcher).
 * All flag-gated (404 when off).
 */
import { test, expect } from '../fixtures.js';

test.describe('Business Features — convergence', () => {
  const routes = [
    { method: 'POST', path: '/api/sites/test/booking/slots' },
    { method: 'POST', path: '/api/sites/test/booking/confirm' },
    { method: 'POST', path: '/api/sites/test/crm/score' },
    { method: 'POST', path: '/api/sites/test/crm/pipeline' },
    { method: 'POST', path: '/api/sites/test/portal/create' },
    { method: 'POST', path: '/api/sites/test/portal/validate' },
    { method: 'POST', path: '/api/sites/test/ab/assign' },
    { method: 'POST', path: '/api/sites/test/ab/significance' },
    { method: 'POST', path: '/api/sites/test/agency/dashboard' },
    { method: 'POST', path: '/api/sites/test/automation/validate' },
    { method: 'GET', path: '/api/apps/catalog' },
    { method: 'POST', path: '/api/apps/launch' },
  ];

  for (const r of routes) {
    test(`${r.method} ${r.path}`, async ({ authedPage }) => {
      const res = await authedPage.evaluate(async ({ method, path }: { method: string; path: string }) => {
        const opts: RequestInit = { method, headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' } };
        if (method !== 'GET') opts.body = JSON.stringify({});
        const r = await fetch(path, opts);
        return r.status;
      }, r);
      expect([200, 400, 404, 502]).toContain(res);
    });
  }
});
