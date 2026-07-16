/**
 * @module services/service_registry
 *
 * Typed service registry — one entry per self-hosted app (Plane, Twenty,
 * Listmonk, Unkey, Postiz, Inngest, CMS, LLM, CRM). The admin dashboard,
 * health probes, and secret-rotation calendar all read from this single SSOT.
 * Pure + deterministic: zero I/O, zero side-effects.
 *
 * @example
 * ```ts
 * const reg = createRegistry(DEFAULT_SERVICES);
 * reg.get('plane');                    // ServiceEntry for Plane
 * reg.byCategory('email');             // [Listmonk]
 * reg.allSecrets();                    // deduped, sorted
 * reg.containers();                    // CF Container services only
 * ```
 */

export interface ServiceEntry {
  /** URL-safe identifier, e.g. 'plane', 'twenty'. */
  readonly slug: string;
  /** Human display name, e.g. 'Plane'. */
  readonly name: string;
  /** One-sentence description of what this service does. */
  readonly description: string;
  /** Live URL, e.g. 'https://pm.projectsites.dev'. */
  readonly url: string;
  /** Relative path for the health endpoint, e.g. '/health'. */
  readonly healthPath: string;
  /** Functional category for grouping. */
  readonly category: 'pm' | 'crm' | 'email' | 'auth' | 'ai' | 'social' | 'media' | 'infra';
  /** Required secret/env names this service needs. */
  readonly secrets: readonly string[];
  /** True when this service runs as a Cloudflare Container. */
  readonly container: boolean;
  /** Optional override label for the status page. */
  readonly statusPageLabel?: string;
}

export interface ServiceRegistry {
  readonly services: readonly ServiceEntry[];
  /** Get one service by slug, or null. */
  get(slug: string): ServiceEntry | null;
  /** All services in a category. */
  byCategory(cat: ServiceEntry['category']): readonly ServiceEntry[];
  /** All secret names across every service (deduped, sorted). */
  allSecrets(): readonly string[];
  /** Services that run as CF Containers. */
  containers(): readonly ServiceEntry[];
}

const KNOWN_CATEGORIES = new Set<ServiceEntry['category']>([
  'pm',
  'crm',
  'email',
  'auth',
  'ai',
  'social',
  'media',
  'infra',
]);

/**
 * Build a frozen {@link ServiceRegistry} from an array of entries.
 * Validates uniqueness (first slug wins on dupe) and known categories
 * (unknown falls back to `'infra'`).
 *
 * @param entries - The service entries to register.
 * @returns A frozen {@link ServiceRegistry}.
 *
 * @example
 * const reg = createRegistry([
 *   { slug: 'plane', name: 'Plane', url: 'https://pm.pd.dev', … },
 * ]);
 */
export function createRegistry(entries: readonly ServiceEntry[]): ServiceRegistry {
  const seen = new Set<string>();
  const services: ServiceEntry[] = [];

  for (const raw of entries) {
    // Validate required fields — skip entries missing essential data.
    if (!raw.slug || !raw.name || !raw.url || !raw.healthPath) continue;

    // Dedupe by slug (first wins).
    if (seen.has(raw.slug)) continue;
    seen.add(raw.slug);

    // Normalize unknown categories to 'infra'.
    const category = KNOWN_CATEGORIES.has(raw.category) ? raw.category : 'infra';

    services.push(
      Object.freeze({ ...raw, category, secrets: Object.freeze([...raw.secrets]) }) as ServiceEntry,
    );
  }

  const frozen = Object.freeze(services);

  const get = (slug: string): ServiceEntry | null => {
    return frozen.find((s) => s.slug === slug) ?? null;
  };

  const byCategory = (cat: ServiceEntry['category']): readonly ServiceEntry[] => {
    return frozen.filter((s) => s.category === cat);
  };

  const allSecrets = (): readonly string[] => {
    const set = new Set<string>();
    for (const s of frozen) {
      for (const secret of s.secrets) {
        set.add(secret);
      }
    }
    return Object.freeze([...set].sort());
  };

  const containers = (): readonly ServiceEntry[] => {
    return frozen.filter((s) => s.container);
  };

  return Object.freeze({ services: frozen, get, byCategory, allSecrets, containers });
}

/**
 * Default registry of known live services at projectsites.dev / megabyte.space.
 *
 * Derived from the running fleet: Plane (pm), Twenty (crm), Listmonk (mail),
 * Unkey (api), Postiz (social), Inngest (events). Descriptions, secrets, and
 * categories reflect real-world deployment state as of 2026-06-29.
 */
export const DEFAULT_SERVICES = Object.freeze([
  Object.freeze({
    slug: 'plane',
    name: 'Plane',
    description: 'Project management and issue tracking (self-hosted)',
    url: 'https://pm.projectsites.dev',
    healthPath: '/api/instances/',
    category: 'pm' as const,
    secrets: Object.freeze([
      'PLANE_SECRET_KEY',
      'PLANE_DB_URL',
      'PLANE_EMAIL_HOST',
      'PLANE_EMAIL_PASS',
    ]),
    container: true,
  }),
  Object.freeze({
    slug: 'twenty',
    name: 'Twenty',
    description: 'Open-source CRM with lead management',
    url: 'https://crm.projectsites.dev',
    healthPath: '/health',
    category: 'crm' as const,
    secrets: Object.freeze(['TWENTY_SECRET_KEY', 'TWENTY_DB_URL', 'TWENTY_APP_SECRET']),
    container: true,
  }),
  Object.freeze({
    slug: 'listmonk',
    name: 'Listmonk',
    description: 'Self-hosted newsletter and email campaign manager',
    url: 'https://mail.projectsites.dev',
    healthPath: '/health',
    category: 'email' as const,
    secrets: Object.freeze(['LISTMONK_DB_URL', 'LISTMONK_SMTP_USER', 'LISTMONK_SMTP_PASS']),
    container: true,
  }),
  Object.freeze({
    slug: 'unkey',
    name: 'Unkey',
    description: 'API key management and rate limiting',
    url: 'https://api.projectsites.dev',
    healthPath: '/v1/health',
    category: 'auth' as const,
    secrets: Object.freeze(['UNKEY_SECRET_KEY', 'UNKEY_DB_URL']),
    container: true,
  }),
  Object.freeze({
    slug: 'social_native',
    name: 'Native Social',
    description: 'Social media publishing — CF-native (Workflows v2 + Upstash + D1)',
    url: 'https://social.projectsites.dev',
    healthPath: '/api/social/accounts',
    category: 'social' as const,
    secrets: Object.freeze([]),
  }),
  Object.freeze({
    slug: 'inngest',
    name: 'Inngest',
    description: 'Event-driven background job and workflow engine',
    url: 'https://events.projectsites.dev',
    healthPath: '/health',
    category: 'infra' as const,
    secrets: Object.freeze(['INNGEST_SIGNING_KEY', 'INNGEST_EVENT_KEY']),
    container: true,
  }),
  Object.freeze({
    slug: 'cms',
    name: 'CMS',
    description: 'Headless content management (Payload)',
    url: 'https://cms.projectsites.dev',
    healthPath: '/api/health',
    category: 'media' as const,
    secrets: Object.freeze(['CMS_SECRET_KEY', 'CMS_DB_URL']),
    container: true,
  }),
  Object.freeze({
    slug: 'llm',
    name: 'LLM',
    description: 'Self-hosted LLM inference (LLM megabyte.space)',
    url: 'https://llm.megabyte.space',
    healthPath: '/health',
    category: 'ai' as const,
    secrets: Object.freeze(['LLM_API_KEY']),
    container: true,
  }),
  Object.freeze({
    slug: 'crm-llm',
    name: 'CRM (LLM)',
    description: 'CRM-backed LLM service (CRM megabyte.space)',
    url: 'https://crm.megabyte.space',
    healthPath: '/health',
    category: 'ai' as const,
    secrets: Object.freeze(['TWENTY_LLM_API_KEY']),
    container: true,
    statusPageLabel: 'CRM LLM',
  }),
]);

/** Singleton registry built from the default services. */
export const DEFAULT_REGISTRY: ServiceRegistry = createRegistry(DEFAULT_SERVICES);
