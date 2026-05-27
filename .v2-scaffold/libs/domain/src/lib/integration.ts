/**
 * Integration + MCP provider SSOT. Mirrors D1 `mcp_connections`,
 * `mcp_oauth_states`, `social_accounts`, `github_integrations`,
 * `google_drive_oauth_states`.
 */
import { z } from 'zod';

export const IntegrationProviderSchema = z.enum([
  'github',
  'google_drive',
  'google_calendar',
  'gmail',
  'slack',
  'mailchimp',
  'hubspot',
  'stripe',
  'square',
  'resend',
  'sendgrid',
  'twilio',
  'sentry',
  'posthog',
  'cloudflare',
  'openai',
  'anthropic',
  'replicate',
  'tavily',
  'firecrawl',
  'context7',
  'upstash',
  'neon',
  'x',
  'facebook',
  'instagram',
  'linkedin',
  'tiktok',
  'youtube',
  'pinterest',
  'threads',
  'bluesky',
] as const);
export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;

export const IntegrationStatusSchema = z.enum([
  'disconnected',
  'connecting',
  'connected',
  'expired',
  'error',
] as const);
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const IntegrationConfigSchema = z
  .object({
    id: z.string().min(1),
    tenant_id: z.string().min(1),
    provider: IntegrationProviderSchema,
    status: IntegrationStatusSchema,
    label: z.string().min(1).nullable(),
    scopes: z.array(z.string()).default([]),
    /** Opaque encrypted blob — never decrypted client-side. */
    encrypted_secret_ref: z.string().min(1).nullable(),
    expires_at: z.iso.datetime({ offset: true }).nullable(),
    last_used_at: z.iso.datetime({ offset: true }).nullable(),
    error_message: z.string().nullable(),
    created_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;
