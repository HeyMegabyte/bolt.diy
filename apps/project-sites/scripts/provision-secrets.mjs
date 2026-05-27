#!/usr/bin/env node
/**
 * @file scripts/provision-secrets.mjs
 * @brief Tiered auto-provisioning entry point. Run before every deploy.
 *
 *   Tier 1  generate locally via openssl   (always auto-runs)
 *   Tier 2  provision via API parent creds (auto-runs when parent cred present)
 *   Tier 3  Computer Use OAuth-app flows   (suggest only — opt-in via --computer-use)
 *   Tier 4  manual paid/KYC                (always report — never auto)
 *
 *   Usage: node scripts/provision-secrets.mjs [--push] [--computer-use] [--env=production]
 *
 *   --push           Push every newly-minted or cached secret to the CF Worker
 *   --computer-use   Launch Computer Use flows for Tier 3 (requires MCP)
 *   --env            Worker env to push to (default: production)
 */

import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMMON_SECRETS,
  ensureGeneratedSecret,
  ensureStripeMeter,
  ensureStripePrice,
  generateBase64Secret,
  generateHexSecret,
  mintCloudflareScopedToken,
  pushSecretToWorker,
  storeSecret,
  syncSecretsToWorker,
  tryGetSecret,
} from './lib/secrets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const ACCOUNT_ID = '84fa0d1b16ff8086dd958c468ce7fd59';
const ZONE_ID = '75a6f8d5e441cd7124552976ba894f83';
const ARGS = new Set(process.argv.slice(2));
const PUSH = ARGS.has('--push');
const COMPUTER_USE = ARGS.has('--computer-use');
const ENV = [...ARGS].find((a) => a.startsWith('--env='))?.slice(6) ?? 'production';

const log = (icon, msg) => console.log(`${icon} ${msg}`);

// ────────────────────────────────────────────────────────────
// Tier 1 — openssl
// ────────────────────────────────────────────────────────────
async function tier1Generate() {
  log('▶', 'Tier 1: openssl-generation');
  const generated = [];

  // Safe to rotate freely (no data-at-rest dependency).
  // WEEKLY_DIGEST_SECRET — rotation just invalidates old unsubscribe URLs.
  // SALE_WEBHOOK_SECRET — only consumed externally; rotation requires re-sharing.
  for (const key of ['WEEKLY_DIGEST_SECRET']) {
    const before = tryGetSecret(key);
    ensureGeneratedSecret(key, () => generateBase64Secret(32));
    if (!before) generated.push(key);
  }
  for (const key of ['SALE_WEBHOOK_SECRET']) {
    const before = tryGetSecret(key);
    ensureGeneratedSecret(key, () => generateHexSecret(32));
    if (!before) generated.push(key);
  }

  // NEVER auto-generate these — they create data-loss risk on rotation:
  //   INTERNAL_BUILD_SECRET — paired with container env; mismatch breaks build callbacks
  //   MCP_ENCRYPTION_KEY    — encrypts MCP OAuth tokens at rest; rotation = decryption fail
  // Surface as warnings only.
  for (const key of ['INTERNAL_BUILD_SECRET', 'MCP_ENCRYPTION_KEY']) {
    if (!tryGetSecret(key)) {
      log('⚠', `${key} absent locally — DO NOT auto-generate (paired/at-rest secret). Pull from Worker via dashboard.`);
    }
  }
  return generated;
}

// ────────────────────────────────────────────────────────────
// Tier 2 — API provisioning
// ────────────────────────────────────────────────────────────
async function tier2CloudflareScopedToken() {
  log('▶', 'Tier 2a: Cloudflare scoped token');
  const existing = tryGetSecret('CF_API_TOKEN_SCOPED');
  if (existing) {
    log('⤳', 'CF_API_TOKEN_SCOPED already minted — skipping');
    return null;
  }
  try {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const { token, id, name } = await mintCloudflareScopedToken({
      accountId: ACCOUNT_ID,
      zoneId: ZONE_ID,
      name: `project-sites-production-scoped-${stamp}`,
      scopes: ['workers', 'kv', 'd1', 'r2', 'ai', 'ai-gateway', 'pages', 'containers', 'tail', 'analytics', 'cache-purge'],
    });
    storeSecret('CF_API_TOKEN_SCOPED', token);
    log('✓', `minted ${name} (id=${id})`);
    return token;
  } catch (e) {
    log('✗', `CF scoped token mint failed: ${e.message}`);
    return null;
  }
}

async function tier2StripePricesAndMeters() {
  log('▶', 'Tier 2b: Stripe Meters + Prices');
  const stripeKey = tryGetSecret('STRIPE_SECRET_KEY');
  if (!stripeKey) {
    log('⤳', 'STRIPE_SECRET_KEY not in chezmoi — skipping');
    return;
  }

  // Meters
  const meters = {
    ai_calls: await ensureStripeMeter({ stripeKey, eventName: 'ai_call', displayName: 'AI Calls' }),
    bytes_egress: await ensureStripeMeter({ stripeKey, eventName: 'bytes_egress_gb', displayName: 'Egress GB' }),
    image_generations: await ensureStripeMeter({ stripeKey, eventName: 'image_generation', displayName: 'Image Generations' }),
  };

  // Metered prices (per-unit, recurring monthly)
  const meteredSpecs = [
    { key: 'ai_calls', lookup: 'projectsites_ai_calls_v1', name: 'ProjectSites AI Calls', cents: 1 },
    { key: 'bytes_egress', lookup: 'projectsites_bytes_egress_v1', name: 'ProjectSites Egress GB', cents: 10 },
    { key: 'image_generations', lookup: 'projectsites_image_generations_v1', name: 'ProjectSites Image Gen', cents: 5 },
  ];
  const usagePriceIds = {};
  for (const s of meteredSpecs) {
    usagePriceIds[s.key] = await ensureStripePrice({
      stripeKey,
      lookupKey: s.lookup,
      productName: s.name,
      unitAmount: s.cents,
      recurring: { interval: 'month', usageType: 'metered' },
      meterId: meters[s.key],
    });
  }
  storeSecret('STRIPE_USAGE_PRICE_IDS', JSON.stringify(usagePriceIds));
  log('✓', `STRIPE_USAGE_PRICE_IDS=${JSON.stringify(usagePriceIds)}`);

  // Credit packs (one-time)
  const creditSpecs = [
    { key: 'STRIPE_PRICE_CREDITS_100', lookup: 'projectsites_credits_100_v1', name: 'ProjectSites 100 AI Credits', cents: 1000 },
    { key: 'STRIPE_PRICE_CREDITS_500', lookup: 'projectsites_credits_500_v1', name: 'ProjectSites 500 AI Credits', cents: 4500 },
    { key: 'STRIPE_PRICE_CREDITS_2000', lookup: 'projectsites_credits_2000_v1', name: 'ProjectSites 2000 AI Credits', cents: 16000 },
  ];
  for (const s of creditSpecs) {
    const id = await ensureStripePrice({
      stripeKey,
      lookupKey: s.lookup,
      productName: s.name,
      unitAmount: s.cents,
    });
    storeSecret(s.key, id);
    log('✓', `${s.key} = ${id}`);
  }
}

// ────────────────────────────────────────────────────────────
// Tier 3 — Computer Use surface (suggest only)
// ────────────────────────────────────────────────────────────
function tier3ComputerUseSuggestions() {
  log('▶', 'Tier 3: Computer Use OAuth flows (suggest only)');
  const tier3 = [
    {
      keys: ['MAILCHIMP_CLIENT_ID', 'MAILCHIMP_CLIENT_SECRET'],
      url: 'https://us1.admin.mailchimp.com/account/oauth2/',
      flow: 'register-oauth-app',
      redirect_uri: 'https://projectsites.dev/api/mcp/mailchimp/callback',
    },
    {
      keys: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'],
      url: 'https://developers.hubspot.com/get-started',
      flow: 'register-oauth-app',
      redirect_uri: 'https://projectsites.dev/api/mcp/hubspot/callback',
    },
    {
      keys: ['STRIPE_CONNECT_CLIENT_ID'],
      url: 'https://dashboard.stripe.com/settings/connect/onboarding-options/oauth',
      flow: 'enable-oauth + add-redirect-uri',
      redirect_uri: 'https://projectsites.dev/api/mcp/stripe/callback',
    },
    {
      keys: ['CLARITY_PROJECT_ID'],
      url: 'https://clarity.microsoft.com/projects/new?name=projectsites.dev&url=https%3A%2F%2Fprojectsites.dev',
      flow: 'add-project',
    },
    {
      keys: ['PLAUSIBLE_DOMAIN'],
      url: 'https://plausible.io/sites/new?domain=projectsites.dev',
      flow: 'add-domain',
    },
    {
      keys: ['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_JSON'],
      url: 'https://console.cloud.google.com/iam-admin/serviceaccounts/create?walkthrough_id=iam--create-service-account',
      flow: 'create-service-account + download-json-key + grant-ga4-viewer',
    },
  ];
  const missing = tier3.filter((spec) => spec.keys.some((k) => !tryGetSecret(k)));
  if (missing.length === 0) {
    log('✓', 'all Tier 3 secrets present');
    return;
  }
  for (const m of missing) {
    log('○', `${m.keys.join(' + ')}`);
    console.log(`     URL  : ${m.url}`);
    console.log(`     Flow : ${m.flow}`);
    if (m.redirect_uri) console.log(`     RedirectURI: ${m.redirect_uri}`);
  }
  if (!COMPUTER_USE) {
    log('ℹ', 'Re-run with --computer-use to launch Playwright-driven OAuth provisioning across all 13 MCP providers');
    return;
  }
  log('▶', 'Tier 3 auto-provisioning via Playwright (scripts/provision-oauth-apps.mjs)');
  const pushFlag = PUSH ? '--push' : '';
  try {
    execSync(
      `node ${join(__dirname, 'provision-oauth-apps.mjs')} --headed --skip-existing ${pushFlag}`.trim(),
      { stdio: 'inherit', cwd: PROJECT_ROOT },
    );
  } catch (e) {
    log('✗', `OAuth provisioner exited non-zero: ${e.message}`);
  }
}

// ────────────────────────────────────────────────────────────
// Tier 4 — manual-only
// ────────────────────────────────────────────────────────────
function tier4ManualReport() {
  log('▶', 'Tier 4: manual (paid plan / KYC required)');
  const tier4 = [
    { keys: ['TRUSTPILOT_API_KEY'], url: 'https://businessapp.b2b.trustpilot.com/access-tokens', reason: 'requires paid Trustpilot Business plan' },
    { keys: ['OPENSRS_USERNAME', 'OPENSRS_API_KEY'], url: 'https://opensrs.com/reseller-signup/', reason: 'reseller account approval ~1 business day' },
    { keys: ['DOMAINR_API_KEY'], url: 'https://rapidapi.com/domainr/api/domainr/pricing', reason: 'RapidAPI subscription' },
  ];
  const missing = tier4.filter((spec) => spec.keys.some((k) => !tryGetSecret(k)));
  if (missing.length === 0) {
    log('✓', 'all Tier 4 secrets present');
    return;
  }
  for (const m of missing) {
    log('○', `${m.keys.join(' + ')} → ${m.url}  (${m.reason})`);
  }
}

// ────────────────────────────────────────────────────────────
// Push to Worker
// ────────────────────────────────────────────────────────────
function pushAll() {
  log('▶', `Pushing all available secrets → CF Worker (env=${ENV})`);
  // Worker-specific names + COMMON_SECRETS
  const allKeys = new Set([
    ...COMMON_SECRETS,
    'CF_API_TOKEN', 'CF_ZONE_ID', 'CF_ACCOUNT_ID',
    'WEEKLY_DIGEST_SECRET', 'SALE_WEBHOOK_SECRET', 'SALE_WEBHOOK_URL',
    'STRIPE_USAGE_PRICE_IDS', 'STRIPE_PRICE_CREDITS_100', 'STRIPE_PRICE_CREDITS_500', 'STRIPE_PRICE_CREDITS_2000',
    'STRIPE_CONNECT_CLIENT_ID', 'METERING_PROVIDER',
    'GOOGLE_PLACES_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'MAILCHIMP_CLIENT_ID', 'MAILCHIMP_CLIENT_SECRET',
    'MAILCHIMP_OAUTH_CLIENT_ID', 'MAILCHIMP_OAUTH_CLIENT_SECRET',
    'HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET',
    'HUBSPOT_OAUTH_CLIENT_ID', 'HUBSPOT_OAUTH_CLIENT_SECRET',
    'NOTION_OAUTH_CLIENT_ID', 'NOTION_OAUTH_CLIENT_SECRET',
    'LINEAR_OAUTH_CLIENT_ID', 'LINEAR_OAUTH_CLIENT_SECRET',
    'SENTRY_OAUTH_CLIENT_ID', 'SENTRY_OAUTH_CLIENT_SECRET',
    'CALENDLY_OAUTH_CLIENT_ID', 'CALENDLY_OAUTH_CLIENT_SECRET',
    'AIRTABLE_OAUTH_CLIENT_ID', 'AIRTABLE_OAUTH_CLIENT_SECRET',
    'ZAPIER_OAUTH_CLIENT_ID', 'ZAPIER_OAUTH_CLIENT_SECRET',
    'CAL_COM_OAUTH_CLIENT_ID', 'CAL_COM_OAUTH_CLIENT_SECRET',
    'PAGERDUTY_OAUTH_CLIENT_ID', 'PAGERDUTY_OAUTH_CLIENT_SECRET',
    'VERCEL_OAUTH_CLIENT_ID', 'VERCEL_OAUTH_CLIENT_SECRET',
    'NETLIFY_OAUTH_CLIENT_ID', 'NETLIFY_OAUTH_CLIENT_SECRET',
    'GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_JSON',
    'CLARITY_PROJECT_ID', 'PLAUSIBLE_DOMAIN',
    'GROQ_API_KEY', 'OPEN_ROUTER_API_KEY',
    'TRUSTPILOT_API_KEY', 'LOTTIEFILES_API_KEY',
    'CHATWOOT_API_URL', 'CHATWOOT_API_KEY',
    'IDEOGRAM_API_KEY', 'REPLICATE_API_TOKEN', 'RUNWAY_API_KEY',
  ]);
  const { pushed, missing } = syncSecretsToWorker({ keys: [...allKeys], env: ENV, cwd: PROJECT_ROOT });
  log('✓', `pushed ${pushed.length}, skipped ${missing.length} absent keys`);
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
(async () => {
  await tier1Generate();
  await tier2CloudflareScopedToken();
  await tier2StripePricesAndMeters();
  tier3ComputerUseSuggestions();
  tier4ManualReport();
  if (PUSH) pushAll();
  log('✓', 'provisioning complete');
})().catch((e) => {
  console.error('✗ provisioning failed:', e);
  process.exit(1);
});
