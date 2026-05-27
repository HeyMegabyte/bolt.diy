/**
 * Integration registry — single config-entry per integration.
 *
 * @remarks
 * Adding a new integration = one entry here. The marketplace, drawer,
 * filter pills, and search all derive from this list.
 *
 * The Slack integration is listed as `disabled: true` per v2 doctrine §21
 * (Slack removed; entry kept for visibility + future re-enable).
 */
import type { IntegrationProvider } from '@org/domain';

export type IntegrationCategory =
  | 'email'
  | 'sms'
  | 'analytics'
  | 'crm'
  | 'payments'
  | 'devops'
  | 'ai'
  | 'storage'
  | 'productivity'
  | 'scheduling'
  | 'social'
  | 'other';

export interface IntegrationDef {
  id: IntegrationProvider | string;
  name: string;
  /** PrimeIcons key or `mdi-*` class. */
  icon: string;
  category: IntegrationCategory;
  description: string;
  /** OAuth scopes requested at connect-time (empty for paste-key only). */
  oauthScopes?: readonly string[];
  /** Whether the worker accepts a paste-in API key fallback. */
  pasteKeyAllowed: boolean;
  /** Public docs link. */
  docsUrl?: string;
  /** Marketplace flag — `true` removes the card. */
  disabled?: boolean;
  /** Per-doctrine §21 reason; surfaced as a tooltip. */
  disabledReason?: string;
}

export const INTEGRATIONS: readonly IntegrationDef[] = [
  // Email
  {
    id: 'resend',
    name: 'Resend',
    icon: 'pi pi-send',
    category: 'email',
    description: 'Transactional + broadcast email via API key.',
    pasteKeyAllowed: true,
    docsUrl: 'https://resend.com/docs',
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    icon: 'pi pi-envelope',
    category: 'email',
    description: 'Marketing email + audience sync.',
    oauthScopes: ['campaigns:read', 'campaigns:write', 'audiences:read'],
    pasteKeyAllowed: false,
    docsUrl: 'https://mailchimp.com/developer/marketing/api/',
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    icon: 'pi pi-envelope',
    category: 'email',
    description: 'Fallback email provider via SMTP API.',
    pasteKeyAllowed: true,
    docsUrl: 'https://docs.sendgrid.com/api-reference',
  },

  // CRM
  {
    id: 'hubspot',
    name: 'HubSpot',
    icon: 'pi pi-users',
    category: 'crm',
    description: 'CRM contacts + deals sync.',
    oauthScopes: ['contacts', 'crm.objects.deals.read', 'crm.objects.deals.write'],
    pasteKeyAllowed: false,
    docsUrl: 'https://developers.hubspot.com',
  },

  // SMS / voice
  {
    id: 'twilio',
    name: 'Twilio',
    icon: 'pi pi-comments',
    category: 'sms',
    description: 'SMS + voice + OTP rails.',
    pasteKeyAllowed: true,
    docsUrl: 'https://www.twilio.com/docs',
  },

  // Payments
  {
    id: 'stripe',
    name: 'Stripe',
    icon: 'pi pi-credit-card',
    category: 'payments',
    description: 'SaaS billing + Connect Express payouts.',
    pasteKeyAllowed: true,
    docsUrl: 'https://stripe.com/docs',
  },
  {
    id: 'square',
    name: 'Square',
    icon: 'pi pi-shop',
    category: 'payments',
    description: 'POS + donations + sub-$100 ticketing.',
    oauthScopes: ['MERCHANT_PROFILE_READ', 'PAYMENTS_READ', 'PAYMENTS_WRITE'],
    pasteKeyAllowed: true,
    docsUrl: 'https://developer.squareup.com/docs',
  },

  // Productivity (Slack disabled per v2 doctrine §21)
  {
    id: 'slack',
    name: 'Slack',
    icon: 'pi pi-slack',
    category: 'productivity',
    description: 'Read-only — v2 doctrine §21 removes outbound Slack.',
    pasteKeyAllowed: false,
    disabled: true,
    disabledReason:
      'Outbound Slack notifications removed in v2. Slack OAuth registration retained for future audit-log read-only use.',
  },

  // DevOps
  {
    id: 'github',
    name: 'GitHub',
    icon: 'pi pi-github',
    category: 'devops',
    description: 'Connect a repo for sync + auto-PRs.',
    oauthScopes: ['repo', 'workflow'],
    pasteKeyAllowed: true,
    docsUrl: 'https://docs.github.com/en/developers',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    icon: 'pi pi-exclamation-triangle',
    category: 'devops',
    description: 'Error tracking + release health.',
    pasteKeyAllowed: true,
    docsUrl: 'https://docs.sentry.io',
  },
  {
    id: 'posthog',
    name: 'PostHog',
    icon: 'pi pi-chart-line',
    category: 'analytics',
    description: 'Product analytics + feature flags.',
    pasteKeyAllowed: true,
    docsUrl: 'https://posthog.com/docs',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    icon: 'pi pi-cloud',
    category: 'devops',
    description: 'Scoped tokens for site infra.',
    pasteKeyAllowed: true,
    docsUrl: 'https://developers.cloudflare.com',
  },

  // AI
  {
    id: 'openai',
    name: 'OpenAI',
    icon: 'pi pi-bolt',
    category: 'ai',
    description: 'GPT-4o + embeddings + audio.',
    pasteKeyAllowed: true,
    docsUrl: 'https://platform.openai.com/docs',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: 'pi pi-bolt',
    category: 'ai',
    description: 'Claude 4.7 + Sonnet + Haiku.',
    pasteKeyAllowed: true,
    docsUrl: 'https://docs.anthropic.com',
  },
  {
    id: 'replicate',
    name: 'Replicate',
    icon: 'pi pi-bolt',
    category: 'ai',
    description: 'Open-source model inference.',
    pasteKeyAllowed: true,
    docsUrl: 'https://replicate.com/docs',
  },

  // Storage / data
  {
    id: 'google_drive',
    name: 'Google Drive',
    icon: 'pi pi-google',
    category: 'storage',
    description: 'Read/write Drive files for the tenant.',
    oauthScopes: ['drive.file', 'drive.readonly'],
    pasteKeyAllowed: false,
    docsUrl: 'https://developers.google.com/drive',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    icon: 'pi pi-google',
    category: 'email',
    description: 'Send + read tenant Gmail.',
    oauthScopes: ['gmail.send', 'gmail.readonly'],
    pasteKeyAllowed: false,
    docsUrl: 'https://developers.google.com/gmail/api',
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    icon: 'pi pi-google',
    category: 'scheduling',
    description: 'Tenant calendar sync.',
    oauthScopes: ['calendar.events', 'calendar.readonly'],
    pasteKeyAllowed: false,
    docsUrl: 'https://developers.google.com/calendar',
  },

  // Infra
  {
    id: 'upstash',
    name: 'Upstash Redis',
    icon: 'pi pi-database',
    category: 'devops',
    description: 'Edge-compatible Redis + queues.',
    pasteKeyAllowed: true,
    docsUrl: 'https://docs.upstash.com',
  },
  {
    id: 'neon',
    name: 'Neon Postgres',
    icon: 'pi pi-database',
    category: 'devops',
    description: 'Serverless Postgres with branching.',
    pasteKeyAllowed: true,
    docsUrl: 'https://neon.tech/docs',
  },

  // Social
  {
    id: 'x',
    name: 'X (Twitter)',
    icon: 'pi pi-twitter',
    category: 'social',
    description: 'Post + read on the tenant X handle.',
    oauthScopes: ['tweet.read', 'tweet.write', 'users.read'],
    pasteKeyAllowed: false,
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: 'pi pi-linkedin',
    category: 'social',
    description: 'Company-page posts + analytics.',
    oauthScopes: ['w_organization_social', 'r_organization_social'],
    pasteKeyAllowed: false,
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: 'pi pi-facebook',
    category: 'social',
    description: 'Page posts + Insights.',
    oauthScopes: ['pages_manage_posts', 'pages_read_engagement'],
    pasteKeyAllowed: false,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: 'pi pi-instagram',
    category: 'social',
    description: 'Business-account publishing.',
    oauthScopes: ['instagram_basic', 'instagram_content_publish'],
    pasteKeyAllowed: false,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    icon: 'pi pi-tiktok',
    category: 'social',
    description: 'Video uploads + analytics.',
    oauthScopes: ['user.info.basic', 'video.publish'],
    pasteKeyAllowed: false,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    icon: 'pi pi-youtube',
    category: 'social',
    description: 'Channel uploads + analytics.',
    oauthScopes: ['youtube.upload', 'youtube.readonly'],
    pasteKeyAllowed: false,
  },

  // Scraping / research
  {
    id: 'tavily',
    name: 'Tavily',
    icon: 'pi pi-search',
    category: 'ai',
    description: 'Web search for AI agents.',
    pasteKeyAllowed: true,
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    icon: 'pi pi-search',
    category: 'ai',
    description: 'Web scraping pipeline.',
    pasteKeyAllowed: true,
  },
  {
    id: 'context7',
    name: 'Context7',
    icon: 'pi pi-book',
    category: 'ai',
    description: 'Library docs MCP.',
    pasteKeyAllowed: true,
  },
];

export const INTEGRATION_CATEGORIES: readonly {
  id: IntegrationCategory | 'all';
  label: string;
}[] = [
  { id: 'all', label: 'All' },
  { id: 'email', label: 'Email' },
  { id: 'sms', label: 'SMS' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'crm', label: 'CRM' },
  { id: 'payments', label: 'Payments' },
  { id: 'devops', label: 'DevOps' },
  { id: 'ai', label: 'AI' },
  { id: 'storage', label: 'Storage' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'scheduling', label: 'Scheduling' },
  { id: 'social', label: 'Social' },
  { id: 'other', label: 'Other' },
];
