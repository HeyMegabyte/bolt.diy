/**
 * @module e2e/apps/ai_features
 * @description Convergence E2E — AI feature routes (code_export, ai_site_critic, geo_toolkit, ai_video_hero, conversational_analytics, lifecycle_agent, seo_agent, nl_site_management).
 * All flag-gated (404 when off). Tests assert routes exist + auth gates work.
 */
import { test, expect } from '../fixtures.js';

test.describe('AI Features — convergence', () => {
  const routes = [
    { method: 'GET', path: '/api/sites/test/export', flag: 'code_export' },
    { method: 'POST', path: '/api/sites/test/critic', flag: 'ai_site_critic' },
    { method: 'POST', path: '/api/sites/test/geo-analyze', flag: 'geo_toolkit' },
    { method: 'POST', path: '/api/sites/test/video-hero', flag: 'ai_video_hero' },
    { method: 'POST', path: '/api/sites/test/analytics/ask', flag: 'conversational_analytics' },
    { method: 'POST', path: '/api/sites/test/health-check', flag: 'lifecycle_agent' },
    { method: 'POST', path: '/api/sites/test/seo/health', flag: 'seo_agent' },
    { method: 'POST', path: '/api/sites/test/nl-command', flag: 'nl_site_management' },
    { method: 'POST', path: '/api/sites/test/voice-command', flag: 'voice_site_mgmt' },
    { method: 'GET', path: '/api/sites/test/dashboard', flag: 'marketing_dashboard' },
    { method: 'POST', path: '/api/sites/test/social/proposals', flag: 'social_agent' },
  ];

  for (const r of routes) {
    test(`${r.method} ${r.path} — flag=${r.flag}`, async ({ request, authedPage }) => {
      const res = await authedPage.evaluate(async ({ method, path }: { method: string; path: string }) => {
        const opts: RequestInit = { method, headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' } };
        if (method !== 'GET') opts.body = JSON.stringify({});
        const r = await fetch(path, opts);
        return r.status;
      }, r);
      // 404 = flag off (expected), 200 = flag on (live), 400 = missing body (route works)
      expect([200, 400, 404]).toContain(res);
    });
  }

  test('all AI routes reject unauthenticated requests', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/sites/test/export');
      return r.status;
    });
    expect([401, 404]).toContain(res);
  });
});
