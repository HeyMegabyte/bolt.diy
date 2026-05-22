/**
 * Single source of truth for MCP (Model Context Protocol) provider metadata.
 *
 * @remarks
 * This list was previously duplicated across `settings.component.ts` (the
 * full 30-entry catalogue with `needsOauth`) and `forms.component.ts` (a
 * subset used to decorate connection pills). Both now import from here.
 *
 * The data is FROZEN to prevent accidental mutation by consumer components.
 * Adding a new provider requires one edit here plus a unit-test entry.
 *
 * @example
 * import { MCP_PROVIDERS, mcpProvider } from './mcp-providers';
 *
 * const stripe = mcpProvider('stripe');
 * stripe?.label;  // 'Stripe'
 * stripe?.color;  // '#635BFF'
 */

/**
 * Shape of one MCP provider entry.
 *
 * @remarks
 * - `id` — stable provider key used as the D1 row key and the URL slug.
 * - `label` — human-readable name shown in the UI.
 * - `desc` — one-sentence pitch shown under the label.
 * - `color` — brand colour used to tint the pill background.
 * - `group` — UI grouping (Email & Comms, CRM & Ops, …).
 * - `needsOauth` — `true` if the provider connects via OAuth, `false` if it
 *   accepts a pasted API key or webhook URL.
 */
export interface McpProvider {
  readonly id: string;
  readonly label: string;
  readonly desc: string;
  readonly color: string;
  readonly group: string;
  readonly needsOauth: boolean;
}

/**
 * Master catalogue of supported MCP providers, grouped by domain.
 *
 * @remarks
 * Order is significant — the Settings → MCP tab renders providers in the
 * order they appear here. New providers should be appended to the bottom of
 * their natural group (do NOT reorder existing entries — UI tests rely on
 * the index of the first entry in each group).
 */
export const MCP_PROVIDERS: readonly McpProvider[] = Object.freeze([
  // Email + Comms
  { id: 'resend',          label: 'Resend',          desc: 'Transactional email (auto-replies, confirmations).',              color: '#000000', needsOauth: false, group: 'Email & Comms' },
  { id: 'mailchimp',       label: 'MailChimp',       desc: 'Subscribe newsletter submissions to a Mailchimp audience.',       color: '#FFE01B', needsOauth: true,  group: 'Email & Comms' },
  { id: 'loops',           label: 'Loops',           desc: 'Email automation for product-led growth — drip + transactional.', color: '#F92672', needsOauth: false, group: 'Email & Comms' },
  { id: 'slack',           label: 'Slack',           desc: 'Post to a Slack channel on form submit or AI events.',            color: '#4A154B', needsOauth: false, group: 'Email & Comms' },
  { id: 'discord',         label: 'Discord',         desc: 'Post to a Discord channel via webhook URL.',                      color: '#5865F2', needsOauth: false, group: 'Email & Comms' },
  { id: 'twilio',          label: 'Twilio',          desc: 'Send SMS confirmations / alerts.',                                color: '#F22F46', needsOauth: false, group: 'Email & Comms' },
  // CRM + Ops
  { id: 'hubspot',         label: 'HubSpot',         desc: 'Create/update HubSpot CRM contacts on form submit.',              color: '#FF7A59', needsOauth: true,  group: 'CRM & Ops' },
  { id: 'notion',          label: 'Notion',          desc: 'Create rows in a Notion database (leads, tickets, ideas).',       color: '#000000', needsOauth: false, group: 'CRM & Ops' },
  { id: 'airtable',        label: 'Airtable',        desc: 'Append rows to an Airtable base.',                                color: '#FFB934', needsOauth: false, group: 'CRM & Ops' },
  { id: 'zapier',          label: 'Zapier',          desc: 'Trigger a Zapier Catch Hook with the form payload.',              color: '#FF4A00', needsOauth: false, group: 'CRM & Ops' },
  // Dev + Issues
  { id: 'github',          label: 'GitHub',          desc: 'Open GitHub issues from forms (bug reports, feature requests).',  color: '#181717', needsOauth: false, group: 'Dev & Issues' },
  { id: 'linear',          label: 'Linear',          desc: 'File Linear issues from customer feedback.',                      color: '#5E6AD2', needsOauth: false, group: 'Dev & Issues' },
  { id: 'sentry',          label: 'Sentry',          desc: 'Capture errors + custom events; auto-link to releases.',          color: '#362D59', needsOauth: false, group: 'Dev & Issues' },
  { id: 'pagerduty',       label: 'PagerDuty',       desc: 'Trigger incidents from form submissions or AI alerts.',           color: '#06AC38', needsOauth: false, group: 'Dev & Issues' },
  // Calendar + Booking
  { id: 'google_calendar', label: 'Google Calendar', desc: 'Create calendar events from booking requests.',                   color: '#4285F4', needsOauth: false, group: 'Calendar & Booking' },
  { id: 'calendly',        label: 'Calendly',        desc: 'List upcoming Calendly events; soon: schedule.',                  color: '#006BFF', needsOauth: false, group: 'Calendar & Booking' },
  { id: 'cal_com',         label: 'Cal.com',         desc: 'Open-source scheduling — embed booking widgets, sync events.',    color: '#0070F3', needsOauth: false, group: 'Calendar & Booking' },
  // Payments + Billing
  { id: 'stripe',          label: 'Stripe',          desc: 'Send invoices, collect deposits, process quote requests.',        color: '#635BFF', needsOauth: true,  group: 'Payments & Billing' },
  { id: 'paddle',          label: 'Paddle',          desc: 'Merchant-of-record billing — global tax, subscriptions.',         color: '#FDB525', needsOauth: false, group: 'Payments & Billing' },
  // Cloudflare stack
  { id: 'cloudflare_workers', label: 'Cloudflare Workers', desc: 'Deploy edge functions tied to forms/AI — Workers for Platforms ready.', color: '#F38020', needsOauth: false, group: 'Cloudflare' },
  { id: 'cloudflare_r2',      label: 'Cloudflare R2',      desc: 'S3-compatible object storage — host uploads + assets.',     color: '#F38020', needsOauth: false, group: 'Cloudflare' },
  { id: 'cloudflare_d1',      label: 'Cloudflare D1',      desc: 'SQLite at the edge — per-site relational data + sync.',     color: '#F38020', needsOauth: false, group: 'Cloudflare' },
  { id: 'cloudflare_kv',      label: 'Cloudflare KV',      desc: 'Global key-value store — caching, feature flags, configs.', color: '#F38020', needsOauth: false, group: 'Cloudflare' },
  // AI providers
  { id: 'openai',          label: 'OpenAI',          desc: 'Bring your own OpenAI key — GPT-4o, embeddings, DALL-E.',         color: '#10A37F', needsOauth: false, group: 'AI Providers' },
  { id: 'anthropic',       label: 'Anthropic',       desc: 'Use your Claude API key — Sonnet, Opus, Haiku.',                  color: '#D97757', needsOauth: false, group: 'AI Providers' },
  { id: 'replicate',       label: 'Replicate',       desc: 'Run any open-source model — Flux, Llama, SDXL.',                  color: '#000000', needsOauth: false, group: 'AI Providers' },
  { id: 'elevenlabs',      label: 'ElevenLabs',      desc: 'Voice synthesis for chat responses, IVR, podcasts.',              color: '#000000', needsOauth: false, group: 'AI Providers' },
  // Observability + Analytics
  { id: 'posthog',         label: 'PostHog',         desc: 'Product analytics + session replay + feature flags.',             color: '#1D4AFF', needsOauth: false, group: 'Observability & Analytics' },
  { id: 'datadog',         label: 'Datadog',         desc: 'Logs, metrics, traces — APM for production sites.',               color: '#632CA6', needsOauth: false, group: 'Observability & Analytics' },
  // Deploy + DNS
  { id: 'vercel',          label: 'Vercel',          desc: 'Trigger Vercel deployments via deploy hook URL.',                 color: '#000000', needsOauth: false, group: 'Deploy & DNS' },
  { id: 'netlify',         label: 'Netlify',         desc: 'Trigger Netlify build hooks for sister deployments.',             color: '#00C7B7', needsOauth: false, group: 'Deploy & DNS' },
]);

/**
 * O(1) lookup table by provider id.
 *
 * @internal
 */
const MCP_PROVIDER_INDEX: Readonly<Record<string, McpProvider>> = Object.freeze(
  MCP_PROVIDERS.reduce<Record<string, McpProvider>>((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, {}),
);

/**
 * Look up one provider by id.
 *
 * @param id - The provider id (e.g. `'stripe'`, `'mailchimp'`).
 * @returns The {@link McpProvider} entry, or `undefined` if no such provider.
 *
 * @example
 * mcpProvider('stripe')?.color; // '#635BFF'
 * mcpProvider('unknown');       // undefined
 */
export function mcpProvider(id: string): McpProvider | undefined {
  return MCP_PROVIDER_INDEX[id];
}
