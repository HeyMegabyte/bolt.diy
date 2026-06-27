#!/usr/bin/env node
/**
 * sync-flags-to-flagship.mjs — push every flag in the D1 FLAG_REGISTRY into
 * Cloudflare Flagship (the native feature-flag service, OpenFeature, public beta).
 *
 * Flagship becomes the edge-evaluated primary; the D1 engine stays the admin
 * source-of-truth + fallback (see middleware/feature-evaluation.ts). This script
 * keeps Flagship's flag DEFINITIONS in lockstep with the registry: one boolean
 * flag per registry entry, default variant from `default_enabled`, a percentage
 * rollout from `default_rollout_percent`, tagged with its `stage`.
 *
 * Reads the registry as text (no TS import needed) so it runs under plain Node.
 *
 * Usage:
 *   node scripts/sync-flags-to-flagship.mjs            # print the Flagship manifest (dry run)
 *   FLAGSHIP_API_BASE=… FLAGSHIP_APP_ID=… FLAGSHIP_API_TOKEN=… \
 *     node scripts/sync-flags-to-flagship.mjs --push   # upsert each flag into Flagship
 *
 * The exact Flagship REST shape is configurable via env so this works as the API
 * stabilises out of beta; with no creds it prints the manifest + what's missing.
 */
import { readFileSync } from 'node:fs';

const REGISTRY = new URL('../src/modules/feature_flags/registry.ts', import.meta.url).pathname;
const src = readFileSync(REGISTRY, 'utf8');

// Each registry entry lists key → description → default_enabled → default_rollout_percent
// → stage in that fixed order; capture the four evaluation-relevant fields per block.
const FLAG_RE =
  /key:\s*'([^']+)',[\s\S]*?default_enabled:\s*(true|false),\s*default_rollout_percent:\s*(\d+),\s*stage:\s*'([^']+)'/g;

const flags = [];
for (const m of src.matchAll(FLAG_RE)) {
  flags.push({
    key: m[1],
    defaultEnabled: m[2] === 'true',
    rolloutPercent: Number(m[3]),
    stage: m[4],
  });
}

if (flags.length === 0) {
  console.error('✘ sync-flags-to-flagship: parsed 0 flags from the registry — aborting.');
  process.exit(1);
}

/** One Flagship boolean flag definition per registry entry. */
const manifest = flags.map((f) => ({
  key: f.key,
  type: 'boolean',
  defaultVariant: f.defaultEnabled ? 'on' : 'off',
  variants: { on: true, off: false },
  // Consistent-hash percentage rollout (Flagship resolves the same key the same way).
  targeting:
    f.rolloutPercent > 0 && f.rolloutPercent < 100
      ? { rollout: { percentage: f.rolloutPercent, variant: 'on' } }
      : undefined,
  tags: [f.stage],
}));

const push = process.argv.includes('--push');
const base = process.env.FLAGSHIP_API_BASE;
const appId = process.env.FLAGSHIP_APP_ID;
const token = process.env.FLAGSHIP_API_TOKEN;

if (!push) {
  console.log(JSON.stringify({ count: manifest.length, flags: manifest }, null, 2));
  console.log(`\n✓ ${manifest.length} flags ready. Re-run with --push (+ FLAGSHIP_* env) to upsert.`);
  process.exit(0);
}

if (!base || !appId || !token) {
  console.error(
    '✘ --push needs FLAGSHIP_API_BASE + FLAGSHIP_APP_ID + FLAGSHIP_API_TOKEN.\n' +
      '  Provision a Flagship app at https://dash.cloudflare.com (Feature Flags / Flagship,\n' +
      '  public beta), then set those three. Until then, the worker evaluates via the D1\n' +
      '  engine (FlagshipEvaluationProvider falls back automatically).',
  );
  process.exit(1);
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
let ok = 0;
let failed = 0;
for (const flag of manifest) {
  const res = await fetch(`${base.replace(/\/+$/, '')}/apps/${appId}/flags/${flag.key}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': UA,
    },
    body: JSON.stringify(flag),
  }).catch(() => null);
  if (res && res.ok) {
    ok++;
  } else {
    failed++;
    console.error(`  ✘ ${flag.key}: ${res ? `HTTP ${res.status}` : 'fetch failed'}`);
  }
}
console.log(`\n${ok} upserted, ${failed} failed (of ${manifest.length}).`);
process.exit(failed > 0 ? 1 : 0);
