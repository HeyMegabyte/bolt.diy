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
  ];
}
