#!/usr/bin/env node
/**
 * check-duplicate-routes.mjs — worker duplicate-route-registration gate.
 *
 * Two handlers registered for the SAME `METHOD /path` on Hono routers all mounted
 * at `/` means the FIRST-registered one WINS and the second is SILENTLY SHADOWED —
 * dead, unreachable code that a reader assumes runs. When the two return different
 * shapes it is a latent lying-empty / wrong-response bug (e.g. `/api/apps/catalog`
 * is registered in `index.ts` returning `{data}` AND in `apps.ts` returning `{apps}`;
 * only the first serves). This gate finds every duplicate registration so NEW
 * accidental shadows can't land, while grandfathering the known ones below.
 *
 * Detection (per validator-precision-discipline — prefers false-negatives):
 *   Scan `src/routes/*.ts` + `src/index.ts` for `<ident>.<method>('<path>')`
 *   registrations, EXCLUDING comment lines (`//`, `*`) and JSDoc `{@link …}`
 *   references (which mention `.post('/…')` in prose). Group by `METHOD /path`;
 *   ≥2 distinct sites = a duplicate.
 *
 * The ALLOWLIST grandfathers duplicates that already exist, each with a reason:
 *   - `intentional` — a deliberate override documented at the mount site
 *     ("must precede `api` so … wins over the legacy route").
 *   - `review` — a likely-accidental shadow pending careful per-instance
 *     resolution (tracked in `.claude/refactor-state.md`). Grandfathered so the
 *     gate can block NEW dups today; remove the entry when the shadow is resolved.
 *
 * Exit 0 report-only by default; `--ci` exits 1 on any NON-allowlisted duplicate.
 *
 * Usage: node scripts/check-duplicate-routes.mjs [--ci]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES_DIR = join(APP_DIR, 'src', 'routes');
const INDEX_TS = join(APP_DIR, 'src', 'index.ts');

const METHOD = '(get|post|put|patch|delete)';
// `<ident>.<method>('<path>'` — path must start with `/`. Captures method + path.
const REG = new RegExp(`\\b[a-zA-Z_$][\\w$]*\\.${METHOD}\\(\\s*['"\`](/[^'"\`]*)['"\`]`);

/**
 * Known-and-accepted duplicate `METHOD /path` keys → reason. Grandfathers existing
 * duplicates so the gate blocks only NEW ones. `review` entries are tracked for
 * resolution; `intentional` entries are permanent documented overrides.
 * @type {Record<string, 'intentional' | 'review'>}
 */
export const ALLOWLIST = {
  // index.ts direct override of appsRoutes' catalog; tangled apps-catalog area.
  'GET /api/apps/catalog': 'intentional',
  // domain_purchase mounted before `api` so the wallet-aware purchase wins over legacy.
  'POST /api/domains/purchase': 'intentional',
  // aiAdmin wins over api.ts — likely accidental; resolve which handler is canonical.
  'GET /api/admin/domains': 'review',
  // Two GET / handlers in index.ts: :747 (system-service landings) shadows :976
  // (richer — adds llm + platform-service landings). Needs a careful host-routing
  // merge; llm root is served by its container so that branch is moot in practice.
  'GET /': 'review',
};

/**
 * Extract every route registration from one file's source. Skips comment lines
 * (`//`, leading `*`) and any line containing a JSDoc `{@link …}` (which quotes
 * `.post('/…')` in prose, not a real registration). Exported for unit testing.
 *
 * @param {string} text - File source.
 * @returns {{ method: string, path: string, line: number }[]}
 */
export function extractRoutes(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (line.includes('{@link')) continue;
    const m = REG.exec(line);
    if (m) out.push({ method: m[1].toUpperCase(), path: m[2], line: i + 1 });
  }
  return out;
}

/**
 * Group registrations across files into duplicates (a `METHOD /path` registered
 * at ≥2 distinct sites). Exported for unit testing.
 *
 * @param {{ file: string, method: string, path: string, line: number }[]} regs
 * @returns {Record<string, { file: string, line: number }[]>} key → sites (dups only)
 */
export function findDuplicates(regs) {
  const byKey = {};
  for (const r of regs) {
    const key = `${r.method} ${r.path}`;
    (byKey[key] ??= []).push({ file: r.file, line: r.line });
  }
  const dups = {};
  for (const [key, sites] of Object.entries(byKey)) {
    if (sites.length >= 2) dups[key] = sites;
  }
  return dups;
}

/** Scan the worker route files + index.ts → all registrations. */
function scan() {
  const regs = [];
  const files = [INDEX_TS];
  if (existsSync(ROUTES_DIR)) {
    for (const f of readdirSync(ROUTES_DIR)) {
      if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.push(join(ROUTES_DIR, f));
    }
  }
  for (const file of files) {
    if (!existsSync(file)) continue;
    const rel = file.slice(APP_DIR.length + 1);
    for (const r of extractRoutes(readFileSync(file, 'utf8'))) {
      regs.push({ file: rel, ...r });
    }
  }
  return regs;
}

function main() {
  const ci = process.argv.includes('--ci');
  const dups = findDuplicates(scan());
  const keys = Object.keys(dups).sort();

  const unlisted = keys.filter((k) => !(k in ALLOWLIST));
  const listed = keys.filter((k) => k in ALLOWLIST);

  if (keys.length === 0) {
    console.log('✅ check-duplicate-routes: clean — no duplicate route registrations.');
    process.exit(0);
  }

  if (listed.length > 0) {
    console.log(`ℹ️  check-duplicate-routes: ${listed.length} grandfathered duplicate(s):`);
    for (const k of listed) {
      const where = dups[k].map((s) => `${s.file}:${s.line}`).join('  +  ');
      console.log(`   [${ALLOWLIST[k]}] ${k}  →  ${where}`);
    }
  }

  if (unlisted.length > 0) {
    console.log(`⚠️  check-duplicate-routes: ${unlisted.length} NEW duplicate route registration(s) — one silently shadows the other:`);
    for (const k of unlisted) {
      const where = dups[k].map((s) => `${s.file}:${s.line}`).join('  +  ');
      console.log(`   FAIL ${k}  →  ${where}`);
    }
    console.log('   The first-registered handler wins; the rest are dead. Remove the duplicate,');
    console.log('   or (if it is a deliberate override) grandfather it in ALLOWLIST with a reason.');
    process.exit(ci ? 1 : 0);
  }

  process.exit(0);
}

// Run as CLI only when invoked directly (never when imported by the unit test).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
