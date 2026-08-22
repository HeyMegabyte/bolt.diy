/**
 * App Launch Controller — provisions infra + registers CNAME + launches
 * app_runtime DO with per-tenant credentials. Pure orchestration schema.
 * Zero I/O — the actual provisioning is done by app_provisioner.ts.
 *
 * This is the "Workers for Platforms" glue — every App in the Apps section
 * launches through this controller. The flow:
 *
 *   1. Customer sets CNAME (crm.customer.com → crm.projectsites.dev)
 *   2. Controller provisions per-tenant infra (Neon DB, Upstash, R2)
 *   3. Credentials encrypted + injected into app_runtime DO env
 *   4. CNAME registered in KV (apphost:crm.customer.com → instanceId)
 *   5. DO boots → reads env → connects to own DB → serves on CNAME
 */
export type AppSlug = 'twenty' | 'listmonk' | 'chatwoot' | 'payload' | 'litellm';

export interface AppCatalogEntry {
  slug: AppSlug; name: string; description: string;
  image: string; // GHCR image ref
  infra: Array<'postgres' | 'redis' | 's3' | 'sqlite' | 'volume' | 'mailrelay'>;
  defaultPort: number; envTemplate: Record<string, string>;
}

export interface LaunchRequest {
  appSlug: AppSlug; siteId: string; orgId: string;
  /** Customer CNAME, e.g. pm.customer.com */
  hostname?: string;
  /** Override default env vars */
  envOverrides?: Record<string, string>;
}

export interface LaunchResult {
  instanceId: string; appSlug: AppSlug;
  appUrl: string; hostname: string | null;
  provisionedSecrets: string[]; // secret names, never values
  status: 'provisioning' | 'running' | 'failed';
  estimatedMonthlyCost: string;
}

/** Per-app catalog — what each app needs to launch. */
export const APP_CATALOG: Record<AppSlug, AppCatalogEntry> = {
  twenty: {
    slug: 'twenty', name: 'Twenty CRM', description: 'Customer relationship management',
    image: 'ghcr.io/twentyhq/twenty:latest', infra: ['postgres', 'redis'],
    defaultPort: 3000, envTemplate: { DATABASE_URL: '${DATABASE_URL}', REDIS_URL: '${REDIS_URL}', APP_SECRET: '${SECRET_KEY}' },
  },
  listmonk: {
    slug: 'listmonk', name: 'Listmonk', description: 'Email newsletter manager',
    image: 'ghcr.io/listmonk/listmonk:latest', infra: ['postgres', 'mailrelay'],
    defaultPort: 9000, envTemplate: { LISTMONK_DB_URL: '${DATABASE_URL}', LISTMONK_SMTP_HOST: 'email-smtp.us-east-1.amazonaws.com' },
  },
  chatwoot: {
    slug: 'chatwoot', name: 'Chatwoot', description: 'Customer support platform',
    image: 'ghcr.io/chatwoot/chatwoot:latest', infra: ['postgres', 'redis'],
    defaultPort: 3000, envTemplate: { DATABASE_URL: '${DATABASE_URL}', REDIS_URL: '${REDIS_URL}', SECRET_KEY_BASE: '${SECRET_KEY}' },
  },
  payload: {
    slug: 'payload', name: 'Payload CMS', description: 'Headless content management',
    image: 'ghcr.io/payloadcms/payload:latest', infra: ['postgres', 's3'],
    defaultPort: 3000, envTemplate: { DATABASE_URL: '${DATABASE_URL}', PAYLOAD_SECRET: '${SECRET_KEY}' },
  },
  litellm: {
    slug: 'litellm', name: 'LiteLLM', description: 'AI model routing proxy',
    image: 'ghcr.io/berriai/litellm:latest', infra: ['postgres'],
    defaultPort: 4000, envTemplate: { DATABASE_URL: '${DATABASE_URL}', LITELLM_MASTER_KEY: '${SECRET_KEY}' },
  },
};

/**
 * Plans a launch: validates the app exists, identifies required infra,
 * and generates the expected hostname + cost estimate.
 */
export function planLaunch(req: LaunchRequest): { valid: boolean; errors: string[]; plan: Partial<LaunchResult> } {
  const errors: string[] = [];
  const entry = APP_CATALOG[req.appSlug];
  if (!entry) { errors.push(`Unknown app: ${req.appSlug}`); return { valid: false, errors, plan: {} }; }
  if (entry.infra.length === 0) { errors.push(`${entry.name} requires zero infra — nothing to provision`); return { valid: false, errors, plan: {} }; }

  const instanceId = `inst_${req.appSlug}_${req.siteId.slice(0, 8)}_${Date.now().toString(36)}`;
  const hostname = req.hostname || `${req.appSlug}.${req.siteId}.app.projectsites.dev`;

  const costPerDb = entry.infra.includes('postgres') ? 5 : 0;
  const costPerRedis = entry.infra.includes('redis') ? 3 : 0;
  const monthly = costPerDb + costPerRedis;

  return {
    valid: true, errors: [],
    plan: {
      instanceId, appSlug: req.appSlug,
      appUrl: `https://${hostname}`, hostname,
      provisionedSecrets: entry.infra.map((i) => `app_${req.appSlug}_${i}`.toUpperCase()),
      status: 'provisioning', estimatedMonthlyCost: `~$${monthly}/mo`,
    },
  };
}

/** Returns the full app catalog for the admin UI. */
export function listApps(): AppCatalogEntry[] { return Object.values(APP_CATALOG); }
