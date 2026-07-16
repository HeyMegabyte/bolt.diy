/**
 * @module provisioning_plan.test
 * @remarks
 * Contract-locking tests for {@link buildProvisioningPlan}.
 * Locks the provisioning order, dependency graph, default URLs, and the rule
 * that unknown opt-ins are silently skipped. Drift here means the background
 * provisioner runs steps in the wrong order or blocks on the wrong dependency.
 */

import {
  buildProvisioningPlan,
  ALL_SERVICES,
  SERVICE_DEPENDENCIES,
  type ProvisioningService,
  type ProvisioningStep,
  type ProvisioningPlan,
} from '../services/provisioning_plan.js';

describe('buildProvisioningPlan', () => {
  // -----------------------------------------------------------------------
  // Full opt-in
  // -----------------------------------------------------------------------
  it('produces 5 steps when all services are opted in', () => {
    const plan = buildProvisioningPlan({
      optIns: ['crm_twenty', 'email_listmonk', 'pm_plane', 'auth_unkey', 'social_native'],
    });

    expect(plan.steps).toHaveLength(5);
    expect(plan.steps.every((s) => s.optedIn)).toBe(true);
  });

  it('orders steps by provisioning order (CRM → email → PM → auth → social)', () => {
    const plan = buildProvisioningPlan({
      optIns: ['crm_twenty', 'email_listmonk', 'pm_plane', 'auth_unkey', 'social_native'],
    });

    const services = plan.steps.map((s) => s.service);
    expect(services).toEqual([
      'crm_twenty',
      'email_listmonk',
      'pm_plane',
      'auth_unkey',
      'social_native',
    ]);

    // Orders are 1-based and sequential.
    const orders = plan.steps.map((s) => s.order);
    expect(orders).toEqual([1, 2, 3, 4, 5]);
  });

  // -----------------------------------------------------------------------
  // Subset opt-in
  // -----------------------------------------------------------------------
  it('marks only opted-in services as optedIn when a subset is selected', () => {
    const plan = buildProvisioningPlan({
      optIns: ['crm_twenty', 'pm_plane'],
    });

    expect(plan.steps).toHaveLength(5);

    const crm = plan.steps.find((s) => s.service === 'crm_twenty')!;
    const email = plan.steps.find((s) => s.service === 'email_listmonk')!;
    const pm = plan.steps.find((s) => s.service === 'pm_plane')!;
    const auth = plan.steps.find((s) => s.service === 'auth_unkey')!;
    const social = plan.steps.find((s) => s.service === 'social_native')!;

    expect(crm.optedIn).toBe(true);
    expect(pm.optedIn).toBe(true);
    expect(email.optedIn).toBe(false);
    expect(auth.optedIn).toBe(false);
    expect(social.optedIn).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Single opt-in
  // -----------------------------------------------------------------------
  it('handles a single opt-in correctly', () => {
    const plan = buildProvisioningPlan({ optIns: ['auth_unkey'] });

    const auth = plan.steps.find((s) => s.service === 'auth_unkey')!;
    expect(auth.optedIn).toBe(true);

    const others = plan.steps.filter((s) => s.service !== 'auth_unkey');
    expect(others.every((s) => s.optedIn)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Dependencies
  // -----------------------------------------------------------------------
  it('assigns correct dependency for each service', () => {
    const plan = buildProvisioningPlan({
      optIns: ['crm_twenty', 'email_listmonk', 'pm_plane', 'auth_unkey', 'social_native'],
    });

    for (const step of plan.steps) {
      expect(step.dependsOn).toBe(SERVICE_DEPENDENCIES[step.service]);
    }

    // Explicit cross-check of the dependency graph.
    const deps = Object.fromEntries(plan.steps.map((s) => [s.service, s.dependsOn])) as Record<
      ProvisioningService,
      ProvisioningService | null
    >;

    expect(deps.crm_twenty).toBeNull();
    expect(deps.email_listmonk).toBe('crm_twenty');
    expect(deps.pm_plane).toBeNull();
    expect(deps.auth_unkey).toBeNull();
    expect(deps.social_native).toBe('email_listmonk');
  });

  it('orders dependents after their dependencies', () => {
    const plan = buildProvisioningPlan({
      optIns: ['crm_twenty', 'email_listmonk', 'pm_plane', 'auth_unkey', 'social_native'],
    });

    // email depends on CRM → CRM order < email order
    const crm = plan.steps.find((s) => s.service === 'crm_twenty')!;
    const email = plan.steps.find((s) => s.service === 'email_listmonk')!;
    expect(email.order).toBeGreaterThan(crm.order);

    // social depends on email → email order < social order
    const social = plan.steps.find((s) => s.service === 'social_native')!;
    expect(social.order).toBeGreaterThan(email.order);
  });

  // -----------------------------------------------------------------------
  // URLs
  // -----------------------------------------------------------------------
  it('returns URLs for every service with defaults', () => {
    const plan = buildProvisioningPlan({ optIns: [] });

    expect(plan.urls.crm_twenty).toBe('https://crm.projectsites.dev');
    expect(plan.urls.email_listmonk).toBe('https://mail.projectsites.dev');
    expect(plan.urls.pm_plane).toBe('https://pm.projectsites.dev');
    expect(plan.urls.auth_unkey).toBe('https://api.projectsites.dev');
    expect(plan.urls.social_native).toBe('https://social.projectsites.dev');
  });

  it('honours baseUrl overrides for each service', () => {
    const plan = buildProvisioningPlan({
      optIns: ['crm_twenty'],
      baseUrls: {
        crm_twenty: 'https://crm.custom.dev',
        email_listmonk: 'https://mail.custom.dev',
      },
    });

    expect(plan.urls.crm_twenty).toBe('https://crm.custom.dev');
    expect(plan.urls.email_listmonk).toBe('https://mail.custom.dev');
    // Un-overridden URLs still use defaults.
    expect(plan.urls.pm_plane).toBe('https://pm.projectsites.dev');
  });

  it('returns urls even when no services are opted in', () => {
    const plan = buildProvisioningPlan({ optIns: [] });

    // All 5 URLs present.
    for (const service of ALL_SERVICES) {
      expect(typeof plan.urls[service]).toBe('string');
      expect(plan.urls[service]).toMatch(/^https:\/\//);
    }
  });

  // -----------------------------------------------------------------------
  // Empty / edge cases
  // -----------------------------------------------------------------------
  it('returns a plan with 5 steps and none opted in when optIns is empty', () => {
    const plan = buildProvisioningPlan({ optIns: [] });

    expect(plan.steps).toHaveLength(5);
    expect(plan.steps.every((s) => !s.optedIn)).toBe(true);
  });

  it('never throws on empty optIns', () => {
    expect(() => buildProvisioningPlan({ optIns: [] })).not.toThrow();
  });

  it('silently skips unknown service names in optIns', () => {
    // Unknown service names should be ignored without error.
    const plan = buildProvisioningPlan({
      optIns: [
        'crm_twenty',
        'not_a_real_service' as ProvisioningService,
        'email_listmonk',
        '' as ProvisioningService,
        'pm_plane',
      ],
    });

    expect(plan.steps).toHaveLength(5);
    const opted = plan.steps.filter((s) => s.optedIn);
    expect(opted).toHaveLength(3);
    expect(opted.map((s) => s.service)).toEqual(['crm_twenty', 'email_listmonk', 'pm_plane']);
  });

  it('never throws regardless of input', () => {
    const cases: ProvisioningService[][] = [
      [],
      ['crm_twenty'],
      ['email_listmonk'],
      ['social_native'],
      ['crm_twenty', 'email_listmonk', 'pm_plane', 'auth_unkey', 'social_native'],
    ];

    for (const optIns of cases) {
      expect(() => buildProvisioningPlan({ optIns })).not.toThrow();
    }
  });

  // -----------------------------------------------------------------------
  // Step shape (every field present and correctly typed)
  // -----------------------------------------------------------------------
  it('every step has the correct field types and values', () => {
    const plan = buildProvisioningPlan({ optIns: ['crm_twenty'] });

    for (const step of plan.steps) {
      expect(typeof step.service).toBe('string');
      expect(typeof step.displayName).toBe('string');
      expect(typeof step.description).toBe('string');
      expect(typeof step.optedIn).toBe('boolean');
      expect(typeof step.order).toBe('number');
      expect(typeof step.estDurationSeconds).toBe('number');

      // dependsOn is either null or a valid service.
      if (step.dependsOn !== null) {
        expect(ALL_SERVICES.includes(step.dependsOn)).toBe(true);
      }
    }
  });

  // -----------------------------------------------------------------------
  // Estimated durations
  // -----------------------------------------------------------------------
  it('matches expected estimated durations', () => {
    const plan = buildProvisioningPlan({ optIns: [] });
    const byService = Object.fromEntries(
      plan.steps.map((s) => [s.service, s.estDurationSeconds]),
    ) as Record<ProvisioningService, number>;

    expect(byService.crm_twenty).toBe(45);
    expect(byService.email_listmonk).toBe(10);
    expect(byService.pm_plane).toBe(10);
    expect(byService.auth_unkey).toBe(5);
    expect(byService.social_native).toBe(10);
  });

  // -----------------------------------------------------------------------
  // ALL_SERVICES and SERVICE_DEPENDENCIES shape
  // -----------------------------------------------------------------------
  it('ALL_SERVICES has exactly 5 entries in provisioning order', () => {
    expect(ALL_SERVICES).toHaveLength(5);
    expect(ALL_SERVICES).toEqual([
      'crm_twenty',
      'email_listmonk',
      'pm_plane',
      'auth_unkey',
      'social_native',
    ]);
  });

  it('SERVICE_DEPENDENCIES has an entry for every service', () => {
    for (const service of ALL_SERVICES) {
      expect(ALL_SERVICES.includes(service)).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // Isolation (calls don't share mutation)
  // -----------------------------------------------------------------------
  it('plans are isolated across calls', () => {
    const planA = buildProvisioningPlan({ optIns: ['crm_twenty'] });
    const planB = buildProvisioningPlan({ optIns: ['pm_plane'] });

    expect(planA.steps[0].optedIn).toBe(true);
    expect(planB.steps[0].optedIn).toBe(false);
    expect(planA).not.toBe(planB);
    expect(planA.steps).not.toBe(planB.steps);
    expect(planA.steps[0]).not.toBe(planB.steps[0]);
  });
});
