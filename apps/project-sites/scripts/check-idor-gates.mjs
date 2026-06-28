#!/usr/bin/env node
/**
 * check-idor-gates.mjs — IDOR regression detector for feature handlers.
 *
 * Caps the 2026-06-28 cross-tenant audit arc (P0 #1/#2 in _LOOP_LEDGER.md): after
 * finding + fixing 7 IDOR gaps where an authed `:siteId`/`:id` route mutated/read a
 * tenant resource without an ownership check, this gate prevents the class from
 * recurring on NEW modules.
 *
 * Heuristic (file-level, per validator-precision-discipline — prefers false-negatives):
 *   A `libs/features/<x>/handlers.ts` is FLAGGED iff it BOTH
 *     (a) registers a route whose path contains a site identifier param
 *         (`:siteId`, or `:id` inside an `/api/sites/:id/…`-style path), AND
 *     (b) contains NONE of the known ownership-gate idioms anywhere in the file.
 *   Ownership idioms: assertSiteOwned · requireOwnedSite · gateOwnedSite · siteOrgId ·
 *   an inline `org_id` comparison/bind (`org_id !==`, `org_id ===`, `org_id = ?`).
 *   Exempt: intentionally-public modules + super-admin-gated modules (allowlists below).
 *
 * Exit 0 always (report-only / soft-info, audit-arc "Surface" step). Pass `--ci` to
 * exit 1 on any finding once the surface is stable at zero.
 *
 * Usage: node scripts/check-idor-gates.mjs [--ci]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEATURES_DIR = join(APP_DIR, 'libs', 'features');

/** Modules whose site-id routes are intentionally public (no auth/ownership by design). */
const PUBLIC_EXEMPT = new Set([
  'agentic_commerce', // ACP storefront feed — public by design
  'visitor_events_core', // public beacon ingest
]);

/** Ownership-gate idioms — presence of ANY means the file guards its site-id routes. */
const OWNERSHIP_IDIOMS = [
  // Known shared ownership helpers (the codebase's gate family — keep in sync).
  /\bassertSiteOwned\b/,
  /\brequireOwnedSite\b/,
  /\bgateOwnedSite\b/,
  /\bfetchOwnedSite\b/,
  /\bverifySiteOwnership\b/,
  /\bsiteOrgId\b/,
  // Generic catch for any future `*OwnedSite*` / `*SiteOwn*` helper.
  /\b\w*Owned[Ss]ite\w*\b/,
  /\b\w*[Ss]iteOwn\w*\b/,
  /org_id\s*(?:!==|===|=\s*\?)/, // inline org compare or scoped SQL bind
  /\bisSuperAdmin\b/, // super-admin-gated surfaces are not per-tenant IDOR
];

/** A route path carries a site identifier the handler must authorize. */
const SITE_ID_ROUTE =
  /\.(get|post|put|patch|delete)\(\s*['"`][^'"`]*(?::siteId|\/sites\/:id\b|:siteId\b)/;

/** @returns {{module:string, file:string}[]} flagged handlers. */
function scan() {
  const flagged = [];
  if (!existsSync(FEATURES_DIR)) return flagged;
  for (const mod of readdirSync(FEATURES_DIR, { withFileTypes: true })) {
    if (!mod.isDirectory() || PUBLIC_EXEMPT.has(mod.name)) continue;
    const handlers = join(FEATURES_DIR, mod.name, 'handlers.ts');
    if (!existsSync(handlers)) continue;
    const text = readFileSync(handlers, 'utf8');
    const hasSiteIdRoute = SITE_ID_ROUTE.test(text);
    if (!hasSiteIdRoute) continue;
    const isGated = OWNERSHIP_IDIOMS.some((re) => re.test(text));
    if (!isGated) flagged.push({ module: mod.name, file: `libs/features/${mod.name}/handlers.ts` });
  }
  return flagged;
}

const ci = process.argv.includes('--ci');
const flagged = scan();

if (flagged.length === 0) {
  console.log('✅ check-idor-gates: clean — every site-id feature handler carries an ownership gate.');
  process.exit(0);
}

console.log(`⚠️  check-idor-gates: ${flagged.length} handler(s) with a site-id route but NO ownership gate:`);
for (const f of flagged) {
  console.log(`   FAIL ${f.file} — add assertSiteOwned(env, c.get('orgId'), siteId) before the service call`);
}
console.log('   (exempt a genuinely-public module via PUBLIC_EXEMPT in this script.)');
process.exit(ci ? 1 : 0);
