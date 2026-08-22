import { planLaunch, listApps } from '../service.js';

describe('planLaunch', () => {
  test('twenty launch plan is valid with postgres + redis', () => {
    const r = planLaunch({ appSlug: 'twenty', siteId: 'site-123', orgId: 'org-1' });
    expect(r.valid).toBe(true);
    expect(r.plan!.instanceId).toContain('inst_twenty');
    expect(r.plan!.hostname).toContain('app.projectsites.dev');
    expect(r.plan!.provisionedSecrets!.length).toBeGreaterThan(0);
    expect(r.plan!.estimatedMonthlyCost).toContain('$');
  });
  test('custom hostname is used in URL', () => {
    const r = planLaunch({ appSlug: 'twenty', siteId: 's1', orgId: 'o1', hostname: 'crm.customer.com' });
    expect(r.plan!.hostname).toBe('crm.customer.com');
    expect(r.plan!.appUrl).toBe('https://crm.customer.com');
  });
  test('all apps have unique slugs', () => {
    const slugs = listApps().map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
  test('every app has required catalog fields', () => {
    for (const app of listApps()) {
      expect(app.slug).toBeTruthy();
      expect(app.name).toBeTruthy();
      expect(app.defaultPort).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(app.infra)).toBe(true);
    }
  });
  test('unknown app returns invalid', () => {
    expect(planLaunch({ appSlug: 'nonexistent' as any, siteId: 's1', orgId: 'o1' }).valid).toBe(false);
  });
});
