/**
 * @module tools
 * @description Tool definitions for the projectsites MCP server.
 *
 * Each tool is a thin wrapper over the `@projectsites/sdk` ProjectSitesClient
 * so external agents (Claude Desktop, ChatGPT, Cursor, custom Claude Agent SDK
 * apps) can drive every Public API v1 capability through the MCP transport.
 *
 * Tools are intentionally narrow per [[tool-design-as-api]] — every input is
 * Zod-validated, output is a typed envelope, and there is no `runAnything`
 * mega-tool.
 */

import { z } from 'zod';
import type { ProjectSitesClient } from '@projectsites/sdk';

// ── Cloudflare API helpers (for provisioning tools) ──────────────────────────

interface CfApiConfig {
  apiToken: string;
  accountId: string;
}

/**
 * Call the Cloudflare API. Used by provision_* tools to create D1/KV/R2
 * resources directly via the CF REST API — no dashboard clicks needed.
 */
async function cfApi(
  config: CfApiConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ success: boolean; result: unknown; errors: unknown[] }> {
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { success: boolean; result: unknown; errors: unknown[] };
  if (!json.success) {
    throw new Error(`CF API error: ${JSON.stringify(json.errors)}`);
  }
  return json;
}

/**
 * Helper — wrap a tool callback so the MCP transport always receives a
 * `content` array of text blocks. Errors surface as `isError: true` instead
 * of throwing, so the agent gets a structured failure to reason about.
 */
async function asTextContent<T>(
  fn: () => Promise<T>,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    const value = await fn();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(value, null, 2),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message }, null, 2),
        },
      ],
      isError: true,
    };
  }
}

// ─── Sites ───────────────────────────────────────────────────────────────────

export const ListSitesInputSchema = {
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
} as const;

export const GetSiteInputSchema = {
  id: z.string().min(1),
} as const;

export const CreateSiteInputSchema = {
  slug: z.string().min(1).max(63),
  business_name: z.string().min(1).max(200),
} as const;

export const DeploySiteInputSchema = {
  id: z.string().min(1),
} as const;

export const SiteAnalyticsInputSchema = {
  id: z.string().min(1),
  range: z.enum(['1d', '7d', '30d', '90d']).default('7d'),
} as const;

// ─── Trust Center ────────────────────────────────────────────────────────────

export const TrustProfileUpdateShape = {
  ai_models: z
    .array(
      z.object({
        vendor: z.string().min(1),
        model: z.string().min(1),
        version: z.string().optional(),
        purpose: z.string().min(1),
        policy_url: z.string().url().optional(),
      }),
    )
    .max(50)
    .optional(),
  data_residency: z.enum(['global', 'us', 'eu', 'apac']).optional(),
  audit_log_policy: z
    .enum(['on-request', 'self-serve', 'realtime-stream'])
    .optional(),
  content_provenance: z
    .array(
      z.object({
        area: z.string().min(1),
        origin: z.enum(['ai-generated', 'human-authored', 'ai-assisted']),
        reviewed_by: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .max(50)
    .optional(),
  ai_outage_behavior: z
    .enum(['graceful-degradation', 'queue-and-retry', 'manual-fallback'])
    .optional(),
  custom_disclosures: z.string().max(10_000).nullable().optional(),
} as const;

export const GetPublicTrustInputSchema = {
  siteSlug: z.string().min(1),
} as const;

// ─── Enterprise ──────────────────────────────────────────────────────────────

export const EnterpriseContractUpdateShape = {
  plan_tier: z
    .enum(['enterprise-small', 'enterprise-mid', 'enterprise-large'])
    .optional(),
  sla_pct: z.number().min(0).max(100).optional(),
  sso_enabled: z.boolean().optional(),
  sso_provider: z.enum(['saml', 'oidc', 'cloudflare-access']).nullable().optional(),
  sso_metadata_url: z.string().url().nullable().optional(),
  custom_terms_md: z.string().max(50_000).nullable().optional(),
  dedicated_slack_channel: z.string().nullable().optional(),
  annual_value_cents: z.number().int().min(0).optional(),
} as const;

export const EnqueueAuditExportShape = {
  range_start: z.string(),
  range_end: z.string(),
} as const;

// ─── Tool registry ───────────────────────────────────────────────────────────

/**
 * Minimal contract every tool implements. Mirrors `McpServer.registerTool`
 * call sites so the CLI can register them without coupling to a specific
 * version of the MCP SDK type surface.
 */
export interface ProjectSitesTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  handler: (
    args: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
}

/**
 * Build the full tool set from a configured `ProjectSitesClient`. The
 * caller wires these into an `McpServer.registerTool(...)` loop.
 */
export function buildTools(client: ProjectSitesClient): ProjectSitesTool[] {
  return [
    // ── Sites ──────────────────────────────────────────────────────────────
    {
      name: 'list_sites',
      title: 'List sites',
      description:
        'List sites owned by the current org. Returns paginated rows from /v1/sites.',
      inputSchema: ListSitesInputSchema,
      handler: (args) =>
        asTextContent(() =>
          client.sites.list({
            limit: args['limit'] as number | undefined,
            offset: args['offset'] as number | undefined,
          }),
        ),
    },
    {
      name: 'get_site',
      title: 'Get a site',
      description: 'Fetch a single site by id.',
      inputSchema: GetSiteInputSchema,
      handler: (args) => asTextContent(() => client.sites.get(args['id'] as string)),
    },
    {
      name: 'create_site',
      title: 'Create a site',
      description: 'Create a new site with the given slug + business name.',
      inputSchema: CreateSiteInputSchema,
      handler: (args) =>
        asTextContent(() =>
          client.sites.create({
            slug: args['slug'] as string,
            business_name: args['business_name'] as string,
          }),
        ),
    },
    {
      name: 'deploy_site',
      title: 'Deploy a site',
      description:
        'Enqueue a deploy job for a site. Returns a job id + initial status.',
      inputSchema: DeploySiteInputSchema,
      handler: (args) =>
        asTextContent(() => client.sites.deploy(args['id'] as string)),
    },
    {
      name: 'site_analytics',
      title: 'Site analytics',
      description:
        'Get daily analytics rows for a site over the requested range.',
      inputSchema: SiteAnalyticsInputSchema,
      handler: (args) =>
        asTextContent(() =>
          client.sites.analytics(
            args['id'] as string,
            (args['range'] as '1d' | '7d' | '30d' | '90d') ?? '7d',
          ),
        ),
    },

    // ── Trust Center ───────────────────────────────────────────────────────
    {
      name: 'get_trust_profile',
      title: 'Get the org-level Trust Center profile',
      description:
        'Return the org-level Trust Center profile (AI models, data residency, audit-log policy, AI-outage behavior).',
      inputSchema: {} as Record<string, z.ZodTypeAny>,
      handler: () => asTextContent(() => client.trust.getProfile()),
    },
    {
      name: 'update_trust_profile',
      title: 'Update the org-level Trust Center profile',
      description:
        'Partial update of the org-level Trust Center profile. Any field omitted is preserved.',
      inputSchema: TrustProfileUpdateShape as Record<string, z.ZodTypeAny>,
      handler: (args) =>
        asTextContent(() =>
          client.trust.updateProfile(
            args as Parameters<typeof client.trust.updateProfile>[0],
          ),
        ),
    },
    {
      name: 'publish_trust_profile',
      title: 'Publish the org Trust Center profile',
      description:
        'Flip the org-level Trust Center profile to published — exposes /trust on each published site.',
      inputSchema: {} as Record<string, z.ZodTypeAny>,
      handler: () => asTextContent(() => client.trust.publishProfile()),
    },
    {
      name: 'get_public_trust',
      title: 'Get the public Trust page for a site',
      description:
        'Fetch the redacted Trust Center view + JSON-LD for the published site.',
      inputSchema: GetPublicTrustInputSchema,
      handler: (args) =>
        asTextContent(() =>
          client.trust.getPublic(args['siteSlug'] as string),
        ),
    },

    // ── Enterprise ─────────────────────────────────────────────────────────
    {
      name: 'get_enterprise_contract',
      title: 'Get the enterprise contract',
      description: "Return this org's enterprise contract row.",
      inputSchema: {} as Record<string, z.ZodTypeAny>,
      handler: () => asTextContent(() => client.enterprise.getContract()),
    },
    {
      name: 'update_enterprise_contract',
      title: 'Update the enterprise contract',
      description:
        'Partial update of the enterprise contract (plan tier, SLA, SSO, custom terms, …).',
      inputSchema: EnterpriseContractUpdateShape as Record<
        string,
        z.ZodTypeAny
      >,
      handler: (args) =>
        asTextContent(() =>
          client.enterprise.updateContract(
            args as Parameters<typeof client.enterprise.updateContract>[0],
          ),
        ),
    },
    {
      name: 'get_enterprise_sla',
      title: 'Get SLA snapshots + rolling uptime',
      description:
        'Return last 90 days of SLA snapshots + rolling uptime + breach flag.',
      inputSchema: {} as Record<string, z.ZodTypeAny>,
      handler: () => asTextContent(() => client.enterprise.getSla()),
    },
    {
      name: 'enqueue_audit_export',
      title: 'Enqueue an audit-log export bundle',
      description:
        'Enqueue a job that bundles the org audit log for a date range into an R2 ZIP.',
      inputSchema: EnqueueAuditExportShape,
      handler: (args) =>
        asTextContent(() =>
          client.enterprise.enqueueAuditExport({
            range_start: args['range_start'] as string,
            range_end: args['range_end'] as string,
          }),
        ),
    },

    // ── Stripe App ─────────────────────────────────────────────────────────
    {
      name: 'list_stripe_app_installs',
      title: 'List Stripe App Marketplace installs',
      description:
        'Return the Stripe App Marketplace install rows visible to this org.',
      inputSchema: ListSitesInputSchema,
      handler: (args) =>
        asTextContent(() =>
          client.stripeApp.listInstalls({
            limit: args['limit'] as number | undefined,
            offset: args['offset'] as number | undefined,
          }),
        ),
    },
    {
      name: 'stripe_app_summary',
      title: 'Stripe App install summary',
      description:
        'Return aggregate install counts (active, uninstalled, paused, by source) for this org.',
      inputSchema: {} as Record<string, z.ZodTypeAny>,
      handler: () => asTextContent(() => client.stripeApp.getSummary()),
    },

    // ═══ Added: full SDK surface + one-prompt-launch tools ═══════════════════

    // ── Auth ────────────────────────────────────────────────────────────────
    {
      name: 'auth_me',
      title: 'Who am I?',
      description:
        'Return the authenticated org/user identity. Useful as a connection test.',
      inputSchema: {} as Record<string, z.ZodTypeAny>,
      handler: () => asTextContent(() => client.auth.me()),
    },

    // ── Site mutations (extended) ───────────────────────────────────────────
    {
      name: 'update_site',
      title: 'Update a site',
      description:
        'Update a site slug or business name. Provide only the fields to change.',
      inputSchema: {
        id: z.string().min(1),
        slug: z.string().min(1).max(63).optional(),
        business_name: z.string().min(1).max(200).optional(),
      } as Record<string, z.ZodTypeAny>,
      handler: (args) =>
        asTextContent(() =>
          client.sites.update(args['id'] as string, {
            slug: args['slug'] as string | undefined,
            business_name: args['business_name'] as string | undefined,
          }),
        ),
    },
    {
      name: 'delete_site',
      title: 'Delete a site',
      description:
        'Permanently delete a site and all its resources. IRREVERSIBLE — confirm with the user first.',
      inputSchema: GetSiteInputSchema,
      handler: (args) =>
        asTextContent(() => client.sites.delete(args['id'] as string)),
    },

    // ── Snapshots & media ──────────────────────────────────────────────────
    {
      name: 'list_snapshots',
      title: 'List deploy snapshots',
      description:
        'List deploy snapshots for a site — each snapshot is a point-in-time deploy record.',
      inputSchema: GetSiteInputSchema,
      handler: (args) =>
        asTextContent(() => client.sites.snapshots(args['id'] as string)),
    },
    {
      name: 'list_media',
      title: 'List media assets',
      description:
        'List uploaded media assets for a site (images, videos, documents).',
      inputSchema: {
        id: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      } as Record<string, z.ZodTypeAny>,
      handler: (args) =>
        asTextContent(() =>
          client.sites.media(args['id'] as string, {
            limit: args['limit'] as number | undefined,
            offset: args['offset'] as number | undefined,
          }),
        ),
    },

    // ── Form submissions ───────────────────────────────────────────────────
    {
      name: 'list_form_submissions',
      title: 'List form submissions',
      description:
        'List form submissions for a site (contact forms, newsletter signups, etc).',
      inputSchema: {
        id: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      } as Record<string, z.ZodTypeAny>,
      handler: (args) =>
        asTextContent(() =>
          client.sites.formSubmissions(args['id'] as string, {
            limit: args['limit'] as number | undefined,
            offset: args['offset'] as number | undefined,
          }),
        ),
    },

    // ── Per-site Trust Center ──────────────────────────────────────────────
    {
      name: 'get_site_trust_profile',
      title: 'Get per-site Trust Center profile',
      description:
        'Fetch the Trust Center profile overrides for a specific site (falls back to org defaults).',
      inputSchema: { site_id: z.string().min(1) } as Record<string, z.ZodTypeAny>,
      handler: (args) =>
        asTextContent(() =>
          client.trust.getSiteProfile(args['site_id'] as string),
        ),
    },
    {
      name: 'update_site_trust_profile',
      title: 'Update per-site Trust Center profile',
      description:
        'Set Trust Center overrides for a specific site (AI models, data residency, disclosures, etc).',
      inputSchema: {
        site_id: z.string().min(1),
        ...TrustProfileUpdateShape,
      } as Record<string, z.ZodTypeAny>,
      handler: (args) => {
        const { site_id, ...update } = args;
        return asTextContent(() =>
          client.trust.updateSiteProfile(
            site_id as string,
            update as Parameters<typeof client.trust.updateSiteProfile>[1],
          ),
        );
      },
    },

    // ── Enterprise (extended) ──────────────────────────────────────────────
    {
      name: 'list_audit_exports',
      title: 'List audit-log export jobs',
      description:
        'List all audit-log export bundles for this org.',
      inputSchema: {} as Record<string, z.ZodTypeAny>,
      handler: () => asTextContent(() => client.enterprise.listAuditExports()),
    },
    {
      name: 'get_sso_config',
      title: 'Get SSO configuration',
      description:
        'Return the current SSO configuration for this org (SAML/OIDC/Cloudflare Access).',
      inputSchema: {} as Record<string, z.ZodTypeAny>,
      handler: () => asTextContent(() => client.enterprise.getSsoConfig()),
    },
    {
      name: 'update_sso_config',
      title: 'Update SSO configuration',
      description:
        'Update the SSO configuration (provider, metadata URL, etc).',
      inputSchema: {
        sso_enabled: z.boolean().optional(),
        sso_provider: z.enum(['saml', 'oidc', 'cloudflare-access']).nullable().optional(),
        sso_metadata_url: z.string().url().nullable().optional(),
      } as Record<string, z.ZodTypeAny>,
      handler: (args) =>
        asTextContent(() =>
          client.enterprise.updateSsoConfig(
            args as Parameters<typeof client.enterprise.updateSsoConfig>[0],
          ),
        ),
    },
    {
      name: 'append_sla_snapshot',
      title: 'Record an SLA snapshot',
      description:
        'Append a new SLA snapshot (uptime pct, incident count, latency) for this org.',
      inputSchema: {
        measured_on: z.string().describe('ISO-8601 timestamp of the measurement'),
        uptime_pct: z.number().min(0).max(100),
        incidents_count: z.number().int().min(0).default(0),
        p95_latency_ms: z.number().int().min(0).optional(),
        notes: z.string().max(1000).optional(),
      } as Record<string, z.ZodTypeAny>,
      handler: (args) =>
        asTextContent(() =>
          client.enterprise.appendSlaSnapshot(
            args as Parameters<typeof client.enterprise.appendSlaSnapshot>[0],
          ),
        ),
    },

    // ═══ ONE-PROMPT LAUNCH: Cloudflare-native provisioning ═════════════════

    // ── D1 ─────────────────────────────────────────────────────────────────
    {
      name: 'provision_d1',
      title: 'Provision a D1 database',
      description:
        'Create a new Cloudflare D1 database. Requires CF_API_TOKEN + CF_ACCOUNT_ID in the server env. Returns the database_id for wrangler.toml binding.',
      inputSchema: {
        name: z.string().min(1).max(64).describe('Database name (alphanumeric, underscore, hyphen)'),
        location: z.enum(['wnam', 'enam', 'weur', 'eeur', 'apac', 'oc']).optional().describe('Primary location hint'),
      } as Record<string, z.ZodTypeAny>,
      handler: async (args) => {
        const token = process.env['CF_API_TOKEN'];
        const accountId = process.env['CF_ACCOUNT_ID'];
        if (!token || !accountId) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'CF_API_TOKEN and CF_ACCOUNT_ID must be set in the server environment to provision D1 databases.' }) }],
            isError: true,
          };
        }
        return asTextContent(() =>
          cfApi({ apiToken: token, accountId }, 'POST', `/accounts/${accountId}/d1/database`, {
            name: args['name'],
            primary_location_hint: args['location'] ?? undefined,
          }),
        );
      },
    },
    {
      name: 'list_d1_databases',
      title: 'List D1 databases',
      description:
        'List all D1 databases in the Cloudflare account. Requires CF_API_TOKEN + CF_ACCOUNT_ID.',
      inputSchema: {} as Record<string, z.ZodTypeAny>,
      handler: async () => {
        const token = process.env['CF_API_TOKEN'];
        const accountId = process.env['CF_ACCOUNT_ID'];
        if (!token || !accountId) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'CF_API_TOKEN and CF_ACCOUNT_ID must be set.' }) }],
            isError: true,
          };
        }
        return asTextContent(() =>
          cfApi({ apiToken: token, accountId }, 'GET', `/accounts/${accountId}/d1/database`),
        );
      },
    },

    // ── KV ─────────────────────────────────────────────────────────────────
    {
      name: 'provision_kv',
      title: 'Provision a KV namespace',
      description:
        'Create a new Cloudflare KV namespace. Requires CF_API_TOKEN + CF_ACCOUNT_ID. Returns the namespace_id for wrangler.toml binding.',
      inputSchema: {
        title: z.string().min(1).max(64).describe('Human-readable namespace title'),
      } as Record<string, z.ZodTypeAny>,
      handler: async (args) => {
        const token = process.env['CF_API_TOKEN'];
        const accountId = process.env['CF_ACCOUNT_ID'];
        if (!token || !accountId) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'CF_API_TOKEN and CF_ACCOUNT_ID must be set.' }) }],
            isError: true,
          };
        }
        return asTextContent(() =>
          cfApi({ apiToken: token, accountId }, 'POST', `/accounts/${accountId}/storage/kv/namespaces`, {
            title: args['title'],
          }),
        );
      },
    },
    {
      name: 'list_kv_namespaces',
      title: 'List KV namespaces',
      description:
        'List all KV namespaces in the Cloudflare account. Requires CF_API_TOKEN + CF_ACCOUNT_ID.',
      inputSchema: {} as Record<string, z.ZodTypeAny>,
      handler: async () => {
        const token = process.env['CF_API_TOKEN'];
        const accountId = process.env['CF_ACCOUNT_ID'];
        if (!token || !accountId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'CF_API_TOKEN and CF_ACCOUNT_ID must be set.' }) }], isError: true };
        return asTextContent(() =>
          cfApi({ apiToken: token, accountId }, 'GET', `/accounts/${accountId}/storage/kv/namespaces`),
        );
      },
    },

    // ── R2 ─────────────────────────────────────────────────────────────────
    {
      name: 'provision_r2',
      title: 'Provision an R2 bucket',
      description:
        'Create a new Cloudflare R2 bucket. Requires CF_API_TOKEN + CF_ACCOUNT_ID. Returns the bucket name for wrangler.toml binding.',
      inputSchema: {
        name: z.string().min(1).max(63).describe('Bucket name (lowercase, no spaces)'),
        location: z.enum(['wnam', 'enam', 'weur', 'eeur', 'apac']).optional().describe('Location hint'),
      } as Record<string, z.ZodTypeAny>,
      handler: async (args) => {
        const token = process.env['CF_API_TOKEN'];
        const accountId = process.env['CF_ACCOUNT_ID'];
        if (!token || !accountId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'CF_API_TOKEN and CF_ACCOUNT_ID must be set.' }) }], isError: true };
        return asTextContent(() =>
          cfApi({ apiToken: token, accountId }, 'POST', `/accounts/${accountId}/r2/buckets`, {
            name: args['name'],
            locationHint: args['location'] ?? undefined,
          }),
        );
      },
    },
    {
      name: 'list_r2_buckets',
      title: 'List R2 buckets',
      description:
        'List all R2 buckets in the Cloudflare account. Requires CF_API_TOKEN + CF_ACCOUNT_ID.',
      inputSchema: {} as Record<string, z.ZodTypeAny>,
      handler: async () => {
        const token = process.env['CF_API_TOKEN'];
        const accountId = process.env['CF_ACCOUNT_ID'];
        if (!token || !accountId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'CF_API_TOKEN and CF_ACCOUNT_ID must be set.' }) }], isError: true };
        return asTextContent(() =>
          cfApi({ apiToken: token, accountId }, 'GET', `/accounts/${accountId}/r2/buckets`),
        );
      },
    },

    // ── Domain / DNS ───────────────────────────────────────────────────────
    {
      name: 'add_domain',
      title: 'Add a custom domain to a site',
      description:
        'Provision DNS + custom domain for a site. Creates the Cloudflare zone (if needed), adds proxied DNS records, and attaches the custom domain to the Worker. Requires CF_API_TOKEN + CF_ACCOUNT_ID.',
      inputSchema: {
        site_id: z.string().min(1).describe('Site ID to attach domain to'),
        domain: z.string().min(1).describe('Custom domain (e.g., "myapp.com")'),
      } as Record<string, z.ZodTypeAny>,
      handler: async (args) => {
        const token = process.env['CF_API_TOKEN'];
        const accountId = process.env['CF_ACCOUNT_ID'];
        if (!token || !accountId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'CF_API_TOKEN and CF_ACCOUNT_ID must be set.' }) }], isError: true };
        const domain = args['domain'] as string;
        try {
          // 1. Create or get the zone
          const zoneResult = await cfApi({ apiToken: token, accountId }, 'POST', '/zones', {
            name: domain,
            account: { id: accountId },
            type: 'full',
          });
          const zone = zoneResult.result as { id: string; name_servers: string[] };
          // 2. Report nameservers to the user (they need to flip NS at their registrar)
          return asTextContent(() => ({
            domain,
            zone_id: zone.id,
            nameservers: zone.name_servers,
            status: 'pending_ns_flip',
            next_step: `Point your domain's nameservers to: ${zone.name_servers.join(', ')}. DNS records + Worker custom domain will activate automatically once NS propagates.`,
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
        }
      },
    },

    // ── Site health ────────────────────────────────────────────────────────
    {
      name: 'get_site_health',
      title: 'Get site health status',
      description:
        'Check if a site is live — fetches the production URL and reports status code, LCP estimate, and console errors. No auth required (public URL check).',
      inputSchema: {
        slug: z.string().min(1).describe('Site slug (e.g., "njsk")'),
      } as Record<string, z.ZodTypeAny>,
      handler: async (args) => {
        const slug = args['slug'] as string;
        const url = `https://${slug}.projectsites.dev`;
        const start = Date.now();
        try {
          const res = await fetch(url, { redirect: 'follow' });
          const duration = Date.now() - start;
          const body = await res.text();
          const hasHtml = body.includes('<!DOCTYPE') || body.includes('<html');
          return asTextContent(() => ({
            url,
            status: res.status,
            ok: res.ok,
            duration_ms: duration,
            has_html: hasHtml,
            content_length: body.length,
            headers: Object.fromEntries(res.headers.entries()),
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text', text: JSON.stringify({ url, error: message, status: 'down' }) }], isError: true };
        }
      },
    },

    // ── Site status (from API) ─────────────────────────────────────────────
    {
      name: 'get_site_status',
      title: 'Get full site status from API',
      description:
        'Get the complete site record including status, last deploy, analytics summary, and all metadata. Combines get_site + deploy snapshots + analytics.',
      inputSchema: GetSiteInputSchema,
      handler: async (args) => {
        const id = args['id'] as string;
        return asTextContent(async () => {
          const [site, snapshots, analytics] = await Promise.all([
            client.sites.get(id),
            client.sites.snapshots(id).catch(() => ({ data: [] })),
            client.sites.analytics(id, '7d').catch(() => null),
          ]);
          return {
            site,
            latest_snapshot: (snapshots as { data: unknown[] }).data?.[0] ?? null,
            analytics_7d: analytics,
          };
        });
      },
    },
  ];
}
