/**
 * Convergence §13 — service registry integrity + exclude-list invariants.
 *
 * The registry is the SSOT for the admin service catalog (§66) and the anchor the
 * architecture-fitness gate (scripts/check-architecture-fitness.mjs) defends.
 * Complements `architecture_fitness.test.ts` (forbidden-vendor source scan) by
 * locking the registry so a §4-excluded vendor can never be blessed as a live
 * dependency, and the live registry stays internally consistent.
 */
import {
  SERVICE_REGISTRY,
  EXCLUDED_VENDORS,
  getService,
  validateServiceRegistry,
  type ServiceRegistryEntry,
} from '../platform/service-registry.js';

describe('service registry integrity', () => {
  it('the live registry has zero violations', () => {
    expect(validateServiceRegistry(SERVICE_REGISTRY)).toEqual([]);
  });

  it('every id is unique', () => {
    const ids = SERVICE_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getService resolves a known entry and returns undefined otherwise', () => {
    expect(getService('jobs-inngest')?.domain).toBe('jobs.projectsites.dev');
    expect(getService('does-not-exist')).toBeUndefined();
  });

  it('detects a duplicate id', () => {
    const dup: ServiceRegistryEntry[] = [
      {
        id: 'x',
        name: 'A',
        category: 'edge',
        runtime: 'cloudflare-worker',
        status: 'production',
        access: 'public',
      },
      {
        id: 'x',
        name: 'B',
        category: 'edge',
        runtime: 'cloudflare-worker',
        status: 'production',
        access: 'public',
      },
    ];
    expect(validateServiceRegistry(dup)).toEqual([{ id: 'x', problem: 'duplicate id' }]);
  });

  it('flags an excluded vendor that is NOT marked deprecated/removed', () => {
    const bad: ServiceRegistryEntry[] = [
      {
        id: 'mail',
        name: 'Resend mailer',
        category: 'email',
        runtime: 'managed-saas',
        status: 'production',
        access: 'service-only',
      },
    ];
    const v = validateServiceRegistry(bad);
    expect(v).toHaveLength(1);
    expect(v[0].problem).toContain('resend');
    expect(v[0].problem).toContain('deprecated/removed');
  });

  it('detects an excluded vendor referenced only via adapterPackage (not just name)', () => {
    // The scan covers `name` + `adapterPackage`; this locks the adapterPackage
    // branch so a forbidden §4 vendor can't slip in behind an innocuous display
    // name by hiding the dependency in the adapter path.
    const hidden: ServiceRegistryEntry[] = [
      {
        id: 'mailer',
        name: 'Transactional email',
        category: 'email',
        runtime: 'managed-saas',
        adapterPackage: 'apps/project-sites/src/services/resend-adapter.ts',
        status: 'production',
        access: 'service-only',
      },
    ];
    const v = validateServiceRegistry(hidden);
    expect(v).toHaveLength(1);
    expect(v[0].problem).toContain('resend');
    expect(v[0].problem).toContain('deprecated/removed');
  });

  it('allows an excluded vendor when correctly marked deprecated (migration in flight)', () => {
    const ok: ServiceRegistryEntry[] = [
      {
        id: 'mail',
        name: 'Resend (legacy)',
        category: 'email',
        runtime: 'managed-saas',
        status: 'deprecated',
        access: 'service-only',
      },
    ];
    expect(validateServiceRegistry(ok)).toEqual([]);
  });

  it('marks Resend deprecated in the live registry (consistent with the §42 migration)', () => {
    expect(getService('email-resend')?.status).toBe('deprecated');
  });

  it('excludes Resend per §4 and names the SES/Listmonk replacements', () => {
    expect(EXCLUDED_VENDORS).toContain('resend');
    expect(getService('email-ses')).toBeDefined();
    expect(getService('email-listmonk')).toBeDefined();
  });
});
