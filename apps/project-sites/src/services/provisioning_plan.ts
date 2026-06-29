/**
 * @module provisioning_plan
 * @remarks
 * AP20 (#326): provisioning checklist for optional add-on services (CRM, email,
 * PM workspace, auth rate-limiting, social scheduler). Built at signup and
 * consumed by a background worker that provisions each service when the user
 * opts in.
 *
 * Pure zero-I/O module — never reads env, never throws.
 *
 * @example
 * ```ts
 * const plan = buildProvisioningPlan({
 *   optIns: ['crm_twenty', 'email_listmonk', 'pm_plane'],
 * });
 * // plan.steps → 5 entries (3 opted in, 2 not)
 * // plan.urls.crm_twenty → 'https://crm.projectsites.dev'
 * ```
 */

/** All 5 supported provisioning services. */
export type ProvisioningService =
  | 'crm_twenty'
  | 'email_listmonk'
  | 'pm_plane'
  | 'auth_unkey'
  | 'social_postiz';

/** A single step in the provisioning checklist. */
export interface ProvisioningStep {
  readonly service: ProvisioningService;
  readonly displayName: string;
  readonly description: string;
  /** true when the user opted in. */
  readonly optedIn: boolean;
  /** Provisioning order (1-based). */
  readonly order: number;
  /** Depends on this service being provisioned first (null = none). */
  readonly dependsOn: ProvisioningService | null;
  /** Estimated provisioning time in seconds (for the loading UI). */
  readonly estDurationSeconds: number;
}

/** Full provisioning plan for a user's opt-in selections. */
export interface ProvisioningPlan {
  readonly steps: readonly ProvisioningStep[];
  /** Provides direct URLs for each opted-in service. */
  readonly urls: Readonly<Record<ProvisioningService, string>>;
}

// ---------------------------------------------------------------------------
// Canonical data
// ---------------------------------------------------------------------------

/** All 5 services in provisioning order (CRM → email → PM → auth → social). */
export const ALL_SERVICES: readonly ProvisioningService[] = [
  'crm_twenty',
  'email_listmonk',
  'pm_plane',
  'auth_unkey',
  'social_postiz',
] as const;

/**
 * Known provisioning dependencies:
 * - CRM provisions first (everything links contacts to it).
 * - Email (Listmonk) depends on CRM for contact import.
 * - Social depends on email for subscriber sync.
 * - PM (Plane) is standalone.
 * - Auth (Unkey) is standalone.
 */
export const SERVICE_DEPENDENCIES: Readonly<
  Record<ProvisioningService, ProvisioningService | null>
> = {
  crm_twenty: null,
  email_listmonk: 'crm_twenty',
  pm_plane: null,
  auth_unkey: null,
  social_postiz: 'email_listmonk',
} as const;

/** Default base URLs for each service. */
const DEFAULT_BASE_URLS: Record<ProvisioningService, string> = {
  crm_twenty: 'https://crm.projectsites.dev',
  email_listmonk: 'https://mail.projectsites.dev',
  pm_plane: 'https://pm.projectsites.dev',
  auth_unkey: 'https://api.projectsites.dev',
  social_postiz: 'https://social.projectsites.dev',
};

/** Display metadata for each service. */
const SERVICE_META: Record<
  ProvisioningService,
  { displayName: string; description: string; estDurationSeconds: number }
> = {
  crm_twenty: {
    displayName: 'CRM (Twenty)',
    description: 'Customer relationship management — contacts, deals, pipeline.',
    estDurationSeconds: 45,
  },
  email_listmonk: {
    displayName: 'Email (Listmonk)',
    description: 'Email campaigns, newsletter, subscriber management.',
    estDurationSeconds: 10,
  },
  pm_plane: {
    displayName: 'Project Management (Plane)',
    description: 'Workspace, issues, sprints, and team collaboration.',
    estDurationSeconds: 10,
  },
  auth_unkey: {
    displayName: 'API Auth (Unkey)',
    description: 'Rate limiting, API key management, and usage enforcement.',
    estDurationSeconds: 5,
  },
  social_postiz: {
    displayName: 'Social Scheduler (Postiz)',
    description: 'Schedule, publish, and analyze social media posts.',
    estDurationSeconds: 10,
  },
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a provisioning plan from a user's opt-in selections.
 *
 * The plan includes ALL 5 services; each is marked `optedIn: true` or
 * `optedIn: false` based on the caller's selections. Unknown service names
 * in `optIns` are silently skipped (never throws).
 *
 * @param opts.optIns - Services the user opted in to.
 * @param opts.baseUrls - Optional overrides for service base URLs.
 * @returns A complete provisioning plan with steps ordered by dependency.
 */
export function buildProvisioningPlan(opts: {
  optIns: readonly ProvisioningService[];
  baseUrls?: Partial<Record<ProvisioningService, string>>;
}): ProvisioningPlan {
  const optedIn = new Set<ProvisioningService>();
  for (const s of opts.optIns) {
    if (ALL_SERVICES.includes(s)) {
      optedIn.add(s);
    }
  }

  const urls: Record<ProvisioningService, string> = {
    crm_twenty: opts.baseUrls?.crm_twenty ?? DEFAULT_BASE_URLS.crm_twenty,
    email_listmonk: opts.baseUrls?.email_listmonk ?? DEFAULT_BASE_URLS.email_listmonk,
    pm_plane: opts.baseUrls?.pm_plane ?? DEFAULT_BASE_URLS.pm_plane,
    auth_unkey: opts.baseUrls?.auth_unkey ?? DEFAULT_BASE_URLS.auth_unkey,
    social_postiz: opts.baseUrls?.social_postiz ?? DEFAULT_BASE_URLS.social_postiz,
  };

  const steps: ProvisioningStep[] = ALL_SERVICES.map((service, i) => {
    const meta = SERVICE_META[service];
    return {
      service,
      displayName: meta.displayName,
      description: meta.description,
      optedIn: optedIn.has(service),
      order: i + 1,
      dependsOn: SERVICE_DEPENDENCIES[service],
      estDurationSeconds: meta.estDurationSeconds,
    };
  });

  return { steps, urls };
}
