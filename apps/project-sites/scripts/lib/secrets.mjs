/**
 * @file scripts/lib/secrets.mjs
 * @brief Shared secret-provisioning helper for every CF Pages / Workers / Vercel / Fly project.
 *
 * Tiered acquisition policy:
 *   1. openssl-generate (HMAC secrets, nonces, encryption keys)
 *   2. API-provision via parent credential (CF global key → scoped token, Stripe → meters+prices,
 *      Anthropic Admin API → project keys, OpenAI Admin API → project keys)
 *   3. Computer Use (OAuth-app creation flows that lack public APIs)
 *   4. Manual (paid plans, KYC-gated reseller signup) — surfaced with deeplinked URLs
 *
 * Storage: every minted secret is age-encrypted via chezmoi and stored at
 * `~/.local/share/chezmoi/home/.chezmoitemplates/secrets-{hostname}/<KEY>`, never echoed.
 *
 * @see ~/.claude/plugins/heymegabyte-claude-skills/rules/secret-auto-provisioning.md
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

const SECRETS_DIR = join(
  homedir(),
  '.local/share/chezmoi/home/.chezmoitemplates',
  `secrets-${hostname().split('.')[0]}`,
);
const GET_SECRET = join(homedir(), '.local/bin/get-secret');

/**
 * Read a secret from chezmoi or env. Returns null when absent (does NOT throw).
 */
export function tryGetSecret(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(join(SECRETS_DIR, key))) return null;
  try {
    return execSync(`${GET_SECRET} ${key}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * Write a value to chezmoi (age-encrypted). Returns true on success.
 */
export function storeSecret(key, value) {
  const path = join(SECRETS_DIR, key);
  try {
    execSync(`chezmoi encrypt > "${path}"`, { input: value, stdio: ['pipe', 'ignore', 'pipe'] });
    return true;
  } catch (e) {
    console.error(`✗ failed to store ${key}: ${e.message}`);
    return false;
  }
}

/** Generate a base64-encoded random secret of n bytes (default 32). */
export function generateBase64Secret(bytes = 32) {
  return execSync(`openssl rand -base64 ${bytes}`).toString().trim();
}

/** Generate a hex-encoded random secret of n bytes (default 32). */
export function generateHexSecret(bytes = 32) {
  return execSync(`openssl rand -hex ${bytes}`).toString().trim();
}

/**
 * Ensure a secret exists locally — generates + stores it if not.
 * Returns the value.
 */
export function ensureGeneratedSecret(key, generator = () => generateBase64Secret(32)) {
  const existing = tryGetSecret(key);
  if (existing) return existing;
  const value = generator();
  storeSecret(key, value);
  console.log(`✓ generated ${key} (len=${value.length})`);
  return value;
}

/**
 * CF auth bootstrap. Returns { mode: 'token' | 'global', headers, ok }.
 * Tries CLOUDFLARE_API_TOKEN first, falls back to CLOUDFLARE_API_KEY+CLOUDFLARE_EMAIL.
 */
export async function ensureCloudflareAuth() {
  const token = tryGetSecret('CLOUDFLARE_API_TOKEN');
  if (token) {
    const r = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) return { mode: 'token', headers: { Authorization: `Bearer ${token}` }, ok: true };
  }
  const key = tryGetSecret('CLOUDFLARE_API_KEY');
  const email = tryGetSecret('CLOUDFLARE_EMAIL');
  if (key && email) {
    const r = await fetch('https://api.cloudflare.com/client/v4/user', {
      headers: { 'X-Auth-Email': email, 'X-Auth-Key': key },
    });
    if (r.ok) return { mode: 'global', headers: { 'X-Auth-Email': email, 'X-Auth-Key': key }, ok: true };
  }
  return { mode: null, headers: null, ok: false };
}

/**
 * Mint a least-privilege CF API token. Uses the global API key to create a scoped
 * token suitable for production deploys (no User Details, no Billing, no account-wide
 * write outside the listed permission groups).
 *
 * @param {Object} opts
 * @param {string} opts.accountId
 * @param {string} opts.zoneId
 * @param {string} opts.name      Token display name (must be unique)
 * @param {string[]} opts.scopes  Subset of: 'workers', 'kv', 'd1', 'r2', 'ai', 'pages',
 *                                'containers', 'tail', 'analytics', 'cache-purge'
 */
export async function mintCloudflareScopedToken({ accountId, zoneId, name, scopes }) {
  const auth = await ensureCloudflareAuth();
  if (auth.mode !== 'global') {
    throw new Error('Scoped-token minting requires the global API key (CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL).');
  }

  const groups = {
    workers: 'e086da7e2179491d91ee5f35b3ca210a',     // Workers Scripts Write
    kv: 'f7f0eda5697f475c90846e879bab8666',          // Workers KV Storage Write
    d1: '09b2857d1c31407795e75e3fed8617a1',          // D1 Write
    r2: 'bf7481a1826f439697cb59a20b22293e',          // Workers R2 Storage Write
    ai: 'bacc64e0f6c34fc0883a1223f938a104',          // Workers AI Write
    'ai-gateway': '6c8a3737f07f46369c1ea1f22138daaf', // AI Gateway Write
    pages: '8d28297797f24fb8a0c332fe0866ec89',       // Pages Write
    containers: 'bdbcd690c763475a985e8641dddc09f7',  // Workers Containers Write
    tail: '05880cd1bdc24d8bae0be2136972816b',        // Workers Tail Read
    analytics: 'b89a480218d04ceb98b4fe57ca29dc1f',   // Account Analytics Read
  };
  const zoneGroups = {
    'cache-purge': 'e17beae8b8cb423a99b1730f21238bed',
  };

  const accountPerms = scopes
    .filter((s) => groups[s])
    .map((s) => ({ id: groups[s], name: s }));
  const zonePerms = scopes
    .filter((s) => zoneGroups[s])
    .map((s) => ({ id: zoneGroups[s], name: s }));

  const policies = [
    {
      effect: 'allow',
      resources: { [`com.cloudflare.api.account.${accountId}`]: '*' },
      permission_groups: accountPerms,
    },
  ];
  if (zonePerms.length && zoneId) {
    policies.push({
      effect: 'allow',
      resources: { [`com.cloudflare.api.account.zone.${zoneId}`]: '*' },
      permission_groups: zonePerms,
    });
  }

  const r = await fetch('https://api.cloudflare.com/client/v4/user/tokens', {
    method: 'POST',
    headers: { ...auth.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, policies }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`CF token mint failed: ${JSON.stringify(j.errors)}`);
  return { token: j.result.value, id: j.result.id, name: j.result.name };
}

/**
 * Push a secret to a Cloudflare Worker via wrangler. Idempotent
 * (wrangler overwrites silently on second run).
 */
export function pushSecretToWorker({ key, value, env = 'production', cwd }) {
  try {
    execSync(`npx wrangler secret put ${key} --env ${env}`, {
      input: value,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(`✓ pushed ${key} → worker (${env})`);
    return true;
  } catch (e) {
    const out = e.stderr?.toString() ?? e.message;
    if (out.includes('already in use')) {
      console.log(`⤳ ${key} is a [vars] binding, not a secret — skipping`);
      return true;
    }
    console.error(`✗ push ${key} failed: ${out.split('\n').slice(-3).join(' ')}`);
    return false;
  }
}

/**
 * Stripe: idempotent product + price creation via lookup_key.
 * Returns the price ID (existing or newly created).
 */
export async function ensureStripePrice({ stripeKey, lookupKey, productName, unitAmount, recurring = null, meterId = null }) {
  // Search existing
  const search = await fetch(
    `https://api.stripe.com/v1/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true`,
    { headers: { Authorization: `Bearer ${stripeKey}` } },
  );
  const found = await search.json();
  if (found.data?.[0]?.id) return found.data[0].id;

  // Create product
  const productBody = new URLSearchParams({
    name: productName,
    type: 'service',
    'metadata[managed_by]': 'projectsites',
    'metadata[lookup_key]': lookupKey,
  });
  const productR = await fetch('https://api.stripe.com/v1/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey}` },
    body: productBody,
  });
  const product = await productR.json();
  if (!product.id) throw new Error(`Stripe product create failed: ${product.error?.message}`);

  // Create price
  const priceBody = new URLSearchParams({
    product: product.id,
    unit_amount: String(unitAmount),
    currency: 'usd',
    lookup_key: lookupKey,
    billing_scheme: 'per_unit',
  });
  if (recurring) {
    priceBody.append('recurring[interval]', recurring.interval);
    if (recurring.usageType) priceBody.append('recurring[usage_type]', recurring.usageType);
    if (meterId) priceBody.append('recurring[meter]', meterId);
  }
  const priceR = await fetch('https://api.stripe.com/v1/prices', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey}` },
    body: priceBody,
  });
  const price = await priceR.json();
  if (!price.id) throw new Error(`Stripe price create failed: ${price.error?.message}`);
  return price.id;
}

/**
 * Stripe Billing Meters: idempotent meter creation by event_name.
 */
export async function ensureStripeMeter({ stripeKey, eventName, displayName }) {
  const list = await fetch('https://api.stripe.com/v1/billing/meters?status=active', {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  const { data } = await list.json();
  const found = data?.find((m) => m.event_name === eventName);
  if (found) return found.id;

  const body = new URLSearchParams({
    display_name: displayName,
    event_name: eventName,
    'default_aggregation[formula]': 'sum',
    'customer_mapping[type]': 'by_id',
    'customer_mapping[event_payload_key]': 'stripe_customer_id',
    'value_settings[event_payload_key]': 'value',
  });
  const r = await fetch('https://api.stripe.com/v1/billing/meters', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey}` },
    body,
  });
  const j = await r.json();
  if (!j.id) throw new Error(`Stripe meter create failed: ${j.error?.message}`);
  return j.id;
}

/**
 * Canonical secrets that every project tries to push during deploy.
 * Silently skipped when absent from get-secret.
 */
export const COMMON_SECRETS = [
  'RESEND_API_KEY',
  'SENDGRID_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PUBLISHABLE_KEY',
  'SQUARE_ACCESS_TOKEN',
  'SQUARE_WEBHOOK_SIGNATURE_KEY',
  'SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'POSTHOG_API_KEY',
  'POSTHOG_PUBLIC_KEY',
  'POSTHOG_HOST',
  'GA4_MEASUREMENT_ID',
  'GA4_API_SECRET',
  'CLERK_SECRET_KEY',
  'CLERK_PUBLISHABLE_KEY',
  'NEON_DATABASE_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'AXIOM_TOKEN',
  'AXIOM_DATASET',
  'INNGEST_EVENT_KEY',
  'INNGEST_SIGNING_KEY',
  'CALCOM_API_KEY',
  'MCP_ENCRYPTION_KEY',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
];

/**
 * Bulk-push every available secret from a list to a Worker.
 */
export function syncSecretsToWorker({ keys, env = 'production', cwd }) {
  const pushed = [];
  const missing = [];
  for (const key of keys) {
    const value = tryGetSecret(key);
    if (!value) {
      missing.push(key);
      continue;
    }
    if (pushSecretToWorker({ key, value, env, cwd })) pushed.push(key);
  }
  return { pushed, missing };
}
