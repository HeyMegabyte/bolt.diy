/**
 * `@org/feature-integrations` — card grid + side-drawer configurator
 * for 20+ providers (Resend / Mailchimp / HubSpot / Twilio / Stripe /
 * GitHub / Linear / Sentry / PostHog / GA4 / OpenAI / Anthropic /
 * Cloudflare / Notion / Calendly / Cal.com / Zapier / Vercel / Netlify
 * / Airtable). Adding a new integration = one entry in `registry.ts`.
 */
export * from './lib/integrations-marketplace/integrations-marketplace.component';
export * from './lib/registry';
export * from './lib/integrations.routes';
