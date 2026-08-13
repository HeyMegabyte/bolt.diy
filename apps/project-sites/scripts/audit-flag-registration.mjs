#!/usr/bin/env node
/**
 * audit-flag-registration.mjs — detect flags that are CHECKED by a route
 * (`isFlagOn(env, 'x', …)` / `requireFlag('x')`) or advertised as a site-features
 * CARD but are NOT in `FLAG_REGISTRY`. `resolveFlag` short-circuits to
 * `enabled:false` for any UNregistered key BEFORE checking overrides — so such a
 * feature can NEVER be enabled (its route always 404s / its card can't toggle).
 * This is the same class that made i18n_localization, agentic_commerce, and
 * page_audio silently dead (fire-31/32).
 *
 * Exit 1 when any CHECKED-but-unregistered flag exists (a live route is dead).
 *
 * Run: node scripts/audit-flag-registration.mjs [--json]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const wantJson = process.argv.includes('--json');

/** Grep the repo for a pattern, returning matched capture-group-1 values (lowercased). */
function grepKeys(pattern) {
  const out = new Set();
  try {
    const raw = execFileSync('grep', ['-rhoE', pattern, 'src/', 'frontend/src/'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of raw.split('\n')) {
      const m = line.match(/'([a-z_][a-z0-9_]*)'/);
      // Ignore sub-3-char keys (regex noise like a lone 'x' from x-org-id contexts).
      if (m && m[1].length >= 3) out.add(m[1]);
    }
  } catch {
    /* grep exits 1 on no match */
  }
  return out;
}

// Registered flags = the keys of the FLAG_REGISTRY object literal.
const registrySrc = readFileSync(join(ROOT, 'src/modules/feature_flags/registry.ts'), 'utf8');
const registered = new Set(
  [...registrySrc.matchAll(/^ {2}([a-z_][a-z0-9_]*):\s*\{/gm)].map((m) => m[1]),
);

// Flags CHECKED by a route (the dead-feature signal when unregistered).
const checked = grepKeys("isFlagOn\\([^,]+,\\s*'[a-z_][a-z0-9_]*'|requireFlag\\('[a-z_][a-z0-9_]*'");
// Flags advertised as a site-features CARD (can't toggle when unregistered).
const carded = grepKeys("key:\\s*'[a-z_][a-z0-9_]*',\\s*name:");

const checkedGaps = [...checked].filter((k) => !registered.has(k)).sort();
const cardedGaps = [...carded].filter((k) => !registered.has(k) && !checked.has(k)).sort();

const findings = [
  ...checkedGaps.map((flag) => ({ flag, severity: 'HIGH', why: 'route checks isFlagOn → always 404 (dead feature)' })),
  ...cardedGaps.map((flag) => ({ flag, severity: 'MEDIUM', why: 'site-features card → cannot toggle (no registry entry)' })),
];
const high = findings.filter((f) => f.severity === 'HIGH');

if (wantJson) {
  console.log(JSON.stringify({ registered: registered.size, checked: checked.size, carded: carded.size, high: high.length, findings }, null, 2));
} else {
  console.log(`\n  Flag-registration audit — ${registered.size} registered / ${checked.size} checked / ${carded.size} carded`);
  console.log(`  ${findings.length} unregistered (${high.length} HIGH — a live route is dead)\n`);
  for (const f of findings) {
    console.log(`  ${f.severity === 'HIGH' ? '❌ HIGH  ' : '·  med   '}${f.flag}  — ${f.why}`);
  }
  console.log(
    high.length
      ? `\n  ${high.length} route(s) check an UNREGISTERED flag → dead. Register each in registry.ts (default_enabled:false).\n`
      : '\n  ✅ Every route-checked flag is registered.\n',
  );
}

process.exit(high.length ? 1 : 0);
