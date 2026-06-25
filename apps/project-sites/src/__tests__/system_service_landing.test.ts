import {
  resolveSystemService,
  systemServiceLanding,
  SYSTEM_SERVICES,
} from '../lib/system_service_landing.js';

describe('system_service_landing', () => {
  it('is now EMPTY — shims removed per Brian (no false-pass 200s)', () => {
    expect(Object.keys(SYSTEM_SERVICES)).toHaveLength(0);
  });

  it('resolves NOTHING — every host falls through to its real app or an honest 404', () => {
    for (const h of [
      'auth.projectsites.dev',
      'browser.projectsites.dev',
      'traces.projectsites.dev',
      'jobs.projectsites.dev',
      'app.projectsites.dev',
      'api.projectsites.dev',
      'billing.projectsites.dev',
      'mail.projectsites.dev',
      'projectsites.dev',
    ]) {
      expect(resolveSystemService(h)).toBeUndefined();
    }
  });

  it('still renders a valid HTML doc if a future static entry is added', () => {
    const html = systemServiceLanding({
      sub: 'demo',
      name: 'Demo',
      what: 'x',
      surface: 'y',
    });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('demo.projectsites.dev');
  });
});
