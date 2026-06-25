import {
  resolveSystemService,
  systemServiceLanding,
  SYSTEM_SERVICES,
} from '../lib/system_service_landing.js';

describe('system_service_landing', () => {
  it('resolves a known system subdomain to its service', () => {
    expect(resolveSystemService('api.projectsites.dev')?.name).toBe('API Gateway');
    expect(resolveSystemService('analytics.projectsites.dev')?.sub).toBe('analytics');
  });

  it('is case-insensitive on the hostname', () => {
    expect(resolveSystemService('BILLING.ProjectSites.dev')?.sub).toBe('billing');
  });

  it('returns undefined for non-system hosts (real apps + customer sites)', () => {
    expect(resolveSystemService('mail.projectsites.dev')).toBeUndefined();
    expect(resolveSystemService('llm.projectsites.dev')).toBeUndefined();
    expect(resolveSystemService('vitos-salon.projectsites.dev')).toBeUndefined();
    expect(resolveSystemService('projectsites.dev')).toBeUndefined();
    expect(resolveSystemService('example.com')).toBeUndefined();
  });

  it('renders a self-contained 200-style HTML doc with an Operational status', () => {
    const html = systemServiceLanding(SYSTEM_SERVICES.api);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('Operational');
    expect(html).toContain('API Gateway');
    expect(html).toContain('api.projectsites.dev');
    expect(html).toContain('<title>API Gateway · ProjectSites</title>');
  });

  it('covers every label host the wildcard would otherwise 404', () => {
    for (const sub of [
      'api',
      'auth',
      'billing',
      'analytics',
      'notify',
      'browser',
      'traces',
      'jobs',
      'app',
    ]) {
      expect(SYSTEM_SERVICES[sub]?.sub).toBe(sub);
    }
  });
});
