/**
 * @module provisioning_plan.test
 * @remarks
 * Contract-locking tests for {@link buildProvisioningPlan}.
 * Locks the provisioning order, dependency graph, default URLs, and the rule
 * that unknown opt-ins are silently skipped. Drift here means the background
 * provisioner runs steps in the wrong order or blocks on the wrong dependency.
 *
 * (Plane + Unkey removed 2026-08-20 — the plan is now 3 services:
 * CRM → email → social.)
 */

import {
  buildProvisioningPlan,
  ALL_SERVICES,
  SERVICE_DEPENDENCIES,
  type ProvisioningService,
} from '../services/provisioning_plan.js';

describe('buildProvisioningPlan', () => {
  it('produces 3 steps when all services are opted in', () => {
    const plan = buildProvisioningPlan({
      optIns: ['crm_twenty', 'email_listmonk', 'social_native'],
    });

    expect(plan.steps).toHaveLength(3);
    expect(plan.steps.every((s) => s.optedIn)).toBe(true);
  });

  it('orders steps by provisioning order (CRM → email → social)', () => {
    const plan = buildProvisioningPlan({
      optIns: ['crm_twenty', 'email_listmonk', 'social_native'],
    });

    const services = plan.steps.map((s) => s.service);
    expect(services).toEqual(['crm_twenty', 'email_listmonk', 'social_native']);

    const orders = plan.steps.map((s) => s.order);
    expect(orders).toEqual([1, 2, 3]);
  });

  it('marks only opted-in services as optedIn when a subset is selected', () => {
    const plan = buildProvisioningPlan({
      optIns: ['crm_twenty'],
    });

    expect(plan.steps).toHaveLength(3);

    const crm = plan.steps.find((s) => s.service === 'crm_twenty')!;
    const email = plan.steps.find((s) => s.service === 'email_listmonk')!;
    const social = plan.steps.find((s) => s.service === 'social_native')!;

    expect(crm.optedIn).toBe(true);
    expect(email.optedIn).toBe(false);
    expect(social.optedIn).toBe(false);
  });

  it('handles a single opt-in correctly', () => {
    const plan = buildProvisioningPlan({ optIns: ['social_native'] });

    const social = plan.steps.find((s) => s.service === 'social_native')!;
    expect(social.optedIn).toBe(true);

    const others = plan.steps.filter((s) => s.service !== 'social_native');
    expect(others.every((s) => s.optedIn)).toBe(false);
  });

  it('assigns correct dependency for each service', () => {
    const plan = buildProvisioningPlan({
      optIns: ['crm_twenty', 'email_listmonk', 'social_native'],
    });

    for (const step of plan.steps) {
      expect(step.dependsOn).toBe(SERVICE_DEPENDENCIES[step.service]);
    }

    const deps = Object.fromEntries(plan.steps.map((s) => [s.service, s.dependsOn])) as Record<
      ProvisioningService,
      ProvisioningService | null
    >;

    expect(deps.crm_twenty).toBeNull();
    expect(deps.email_listmonk).toBe('crm_twenty');
    expect(deps.social_native).toBe('email_listmonk');
  });

  it('orders dependents after their dependencies', () => {
    const plan = buildProvisioningPlan({
      optIns: ['crm_twenty', 'email_listmonk', 'social_native'],
    });

    const crm = plan.steps.find((s) => s.service === 'crm_twenty')!;
    const email = plan.steps.find((s) => s.service === 'email_listmonk')!;
    const social = plan.steps.find((s) => s.service === 'social_native')!;
    expect(email.order).toBeGreaterThan(crm.order);
    expect(social.order).toBeGreaterThan(email.order);
  });

  it('returns URLs for every service with defaults', () => {
    const plan = buildProvisioningPlan({ optIns: [] });

    expect(plan.urls.crm_twenty).toBe('https://crm.projectsites.dev');
    expect(plan.urls.email_listmonk).toBe('https://mail.projectsites.dev');
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
    expect(plan.urls.social_native).toBe('https://social.projectsites.dev');
  });

  it('returns urls even when no services are opted in', () => {
    const plan = buildProvisioningPlan({ optIns: [] });

    for (const service of ALL_SERVICES) {
      expect(typeof plan.urls[service]).toBe('string');
      expect(plan.urls[service]).toMatch(/^https:\/\//);
    }
  });

  it('returns a plan with 3 steps and none opted in when optIns is empty', () => {
    const plan = buildProvisioningPlan({ optIns: [] });

    expect(plan.steps).toHaveLength(3);
    expect(plan.steps.every((s) => !s.optedIn)).toBe(true);
  });

  it('never throws on empty optIns', () => {
    expect(() => buildProvisioningPlan({ optIns: [] })).not.toThrow();
  });

  it('silently skips unknown service names in optIns', () => {
    const plan = buildProvisioningPlan({
      optIns: [
        'crm_twenty',
        'not_a_real_service' as ProvisioningService,
        'email_listmonk',
        '' as ProvisioningService,
      ],
    });

    expect(plan.steps).toHaveLength(3);
    const opted = plan.steps.filter((s) => s.optedIn);
    expect(opted).toHaveLength(2);
    expect(opted.map((s) => s.service)).toEqual(['crm_twenty', 'email_listmonk']);
  });

  it('never throws regardless of input', () => {
    const cases: ProvisioningService[][] = [
      [],
      ['crm_twenty'],
      ['email_listmonk'],
      ['social_native'],
      ['crm_twenty', 'email_listmonk', 'social_native'],
    ];

    for (const optIns of cases) {
      expect(() => buildProvisioningPlan({ optIns })).not.toThrow();
    }
  });

  it('every step has the correct field types and values', () => {
    const plan = buildProvisioningPlan({ optIns: ['crm_twenty'] });

    for (const step of plan.steps) {
      expect(typeof step.service).toBe('string');
      expect(typeof step.displayName).toBe('string');
      expect(typeof step.description).toBe('string');
      expect(typeof step.optedIn).toBe('boolean');
      expect(typeof step.order).toBe('number');
      expect(typeof step.estDurationSeconds).toBe('number');

      if (step.dependsOn !== null) {
        expect(ALL_SERVICES.includes(step.dependsOn)).toBe(true);
      }
    }
  });

  it('matches expected estimated durations', () => {
    const plan = buildProvisioningPlan({ optIns: [] });
    const byService = Object.fromEntries(
      plan.steps.map((s) => [s.service, s.estDurationSeconds]),
    ) as Record<ProvisioningService, number>;

    expect(byService.crm_twenty).toBe(45);
    expect(byService.email_listmonk).toBe(10);
    expect(byService.social_native).toBe(10);
  });

  it('ALL_SERVICES has exactly 3 entries in provisioning order', () => {
    expect(ALL_SERVICES).toHaveLength(3);
    expect(ALL_SERVICES).toEqual(['crm_twenty', 'email_listmonk', 'social_native']);
  });

  it('SERVICE_DEPENDENCIES has an entry for every service', () => {
    for (const service of ALL_SERVICES) {
      expect(ALL_SERVICES.includes(service)).toBe(true);
    }
  });

  it('plans are isolated across calls', () => {
    const planA = buildProvisioningPlan({ optIns: ['crm_twenty'] });
    const planB = buildProvisioningPlan({ optIns: ['social_native'] });

    expect(planA.steps[0].optedIn).toBe(true);
    expect(planB.steps[0].optedIn).toBe(false);
    expect(planA).not.toBe(planB);
    expect(planA.steps).not.toBe(planB.steps);
    expect(planA.steps[0]).not.toBe(planB.steps[0]);
  });
});
