import {
  resolveSystemService,
  systemServiceLanding,
  SYSTEM_SERVICES,
} from '../lib/system_service_landing.js';

describe('system_service_landing', () => {
  it('resolves a known system subdomain to its service', () => {
    expect(resolveSystemService('auth.projectsites.dev')?.name).toBe('Auth / Identity');
    expect(resolveSystemService('browser.projectsites.dev')?.sub).toBe('browser');
  });

  it('is case-insensitive on the hostname', () => {
    expect(resolveSystemService('JOBS.ProjectSites.dev')?.sub).toBe('jobs');
  });

  it('returns undefined for non-system hosts + removed hosts (api/billing/analytics/notify)', () => {
    expect(resolveSystemService('mail.projectsites.dev')).toBeUndefined();
    expect(resolveSystemService('llm.projectsites.dev')).toBeUndefined();
    expect(resolveSystemService('vitos-salon.projectsites.dev')).toBeUndefined();
    expect(resolveSystemService('projectsites.dev')).toBeUndefined();
    expect(resolveSystemService('example.com')).toBeUndefined();
    // Removed per Brian 2026-06-25 — these are gone, must no longer resolve.
    expect(resolveSystemService('api.projectsites.dev')).toBeUndefined();
    expect(resolveSystemService('billing.projectsites.dev')).toBeUndefined();
    expect(resolveSystemService('analytics.projectsites.dev')).toBeUndefined();
    expect(resolveSystemService('notify.projectsites.dev')).toBeUndefined();
  });

  it('renders a self-contained 200-style HTML doc with an Operational status', () => {
    const html = systemServiceLanding(SYSTEM_SERVICES.auth);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('Operational');
    expect(html).toContain('Auth / Identity');
    expect(html).toContain('auth.projectsites.dev');
    expect(html).toContain('<title>Auth / Identity · ProjectSites</title>');
  });

  it('covers the kept label hosts the wildcard would otherwise 404', () => {
    for (const sub of ['auth', 'browser', 'traces', 'jobs', 'app']) {
      expect(SYSTEM_SERVICES[sub]?.sub).toBe(sub);
    }
  });
});
