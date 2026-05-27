#!/usr/bin/env node
/**
 * @file scripts/provision-oauth-apps.mjs
 * @brief Tier-3 OAuth-app provisioner. Drives the dev-portal of each MCP provider
 *        via Playwright, captures the minted client_id + client_secret, stores them
 *        chezmoi-encrypted under `~/.local/share/chezmoi/home/.chezmoitemplates/secrets-<host>/`,
 *        then optionally pushes to the project-sites Worker via `wrangler secret put`.
 *
 * Usage:
 *   node scripts/provision-oauth-apps.mjs                       # all providers, launch mode
 *   node scripts/provision-oauth-apps.mjs --provider=notion     # one provider
 *   node scripts/provision-oauth-apps.mjs --cdp                 # attach to Chrome at :9222
 *   node scripts/provision-oauth-apps.mjs --push                # also wrangler secret put
 *   node scripts/provision-oauth-apps.mjs --headed              # show browser window
 *   node scripts/provision-oauth-apps.mjs --skip-existing       # skip providers already in chezmoi
 *
 * Modes:
 *   --cdp     Connect to a Chrome that was launched with `--remote-debugging-port=9222`.
 *             Uses Brian's existing logged-in profile. Best UX, requires Chrome restart.
 *   --launch  (default) Launches Playwright Chromium with persistentContext at
 *             `/tmp/oauth-provisioner-profile`. User logs in once per provider,
 *             session persists across runs.
 *
 * Each provider module exports a `provider` object with:
 *   - name              short slug (matches MCP provider id)
 *   - redirectUri       OAuth callback URL we register
 *   - portalUrl         where to navigate first
 *   - envKeys           { client_id, client_secret } chezmoi key names
 *   - provision(page)   async fn that returns { client_id, client_secret }
 *
 * @see ~/.claude/plugins/heymegabyte-claude-skills/rules/secret-auto-provisioning.md
 * @see apps/project-sites/src/routes/mcp_oauth.ts (OAUTH_CLIENT_ID_ENV map)
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { pushSecretToWorker, storeSecret, tryGetSecret } from './lib/secrets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PROVIDERS_DIR = join(__dirname, 'oauth-providers');
const PROFILE_DIR = '/tmp/oauth-provisioner-profile';

const ARGS = process.argv.slice(2);
const CDP = ARGS.includes('--cdp');
const HEADED = ARGS.includes('--headed') || !ARGS.includes('--headless');
const PUSH = ARGS.includes('--push');
const SKIP_EXISTING = ARGS.includes('--skip-existing');
const ONLY = ARGS.find((a) => a.startsWith('--provider='))?.slice(11);

const log = (icon, msg) => console.log(`${icon} ${msg}`);

async function loadProviders() {
  const files = readdirSync(PROVIDERS_DIR).filter((f) => f.endsWith('.mjs'));
  const providers = [];
  for (const f of files) {
    const mod = await import(join(PROVIDERS_DIR, f));
    if (mod.provider) providers.push(mod.provider);
  }
  return providers;
}

async function openBrowser() {
  if (CDP) {
    log('▶', 'Connecting to Chrome at http://localhost:9222 (CDP)');
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    return { browser, ctx, mode: 'cdp' };
  }
  log('▶', `Launching Playwright Chromium with persistent profile ${PROFILE_DIR}`);
  mkdirSync(PROFILE_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !HEADED,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  return { browser: null, ctx, mode: 'launch' };
}

async function closeBrowser({ browser, ctx, mode }) {
  if (mode === 'launch') await ctx.close();
  if (browser) await browser.close();
}

async function provisionOne(provider, ctx) {
  const { name, envKeys, redirectUri, portalUrl, apiOnly } = provider;
  const idKey = envKeys.client_id;
  const secretKey = envKeys.client_secret;
  log('▶', `Provisioning ${name} → ${redirectUri}`);
  if (SKIP_EXISTING && tryGetSecret(idKey) && tryGetSecret(secretKey)) {
    log('⤳', `${idKey} + ${secretKey} already in chezmoi — skipping`);
    return { name, skipped: true };
  }
  const page = apiOnly ? null : await ctx.newPage();
  try {
    if (page) {
      log('  ', `→ ${portalUrl}`);
      await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    const result = await provider.provision(page, { redirectUri });
    if (!result?.client_id || !result?.client_secret) {
      throw new Error(`provision() returned no credentials: ${JSON.stringify(result)}`);
    }
    storeSecret(idKey, result.client_id);
    storeSecret(secretKey, result.client_secret);
    log('✓', `stored ${idKey} (len=${result.client_id.length})`);
    log('✓', `stored ${secretKey} (len=${result.client_secret.length})`);
    if (PUSH) {
      pushSecretToWorker({ key: idKey, value: result.client_id, env: 'production', cwd: PROJECT_ROOT });
      pushSecretToWorker({ key: secretKey, value: result.client_secret, env: 'production', cwd: PROJECT_ROOT });
    }
    return { name, ok: true, idKey, secretKey };
  } catch (e) {
    log('✗', `${name} failed: ${e.message}`);
    return { name, error: e.message };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

(async () => {
  const providers = await loadProviders();
  const targets = ONLY ? providers.filter((p) => p.name === ONLY) : providers;
  if (targets.length === 0) {
    log('✗', `No providers matched ${ONLY ?? '(all)'}. Available: ${providers.map((p) => p.name).join(', ')}`);
    process.exit(1);
  }
  log('▶', `${targets.length} provider(s) to provision: ${targets.map((p) => p.name).join(', ')}`);

  const needsBrowser = targets.some((p) => !p.apiOnly);
  const browser = needsBrowser ? await openBrowser() : { ctx: null, browser: null, mode: 'none' };
  const results = [];
  for (const provider of targets) {
    results.push(await provisionOne(provider, browser.ctx));
  }
  if (needsBrowser) await closeBrowser(browser);

  const ok = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => r.error);
  log('✓', `complete: ${ok} provisioned, ${skipped} skipped, ${failed.length} failed`);
  if (failed.length) {
    failed.forEach((r) => console.error(`  ✗ ${r.name}: ${r.error}`));
    process.exit(1);
  }
})().catch((e) => {
  console.error('✗ provisioner crashed:', e);
  process.exit(1);
});
