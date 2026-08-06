#!/usr/bin/env node
/**
 * validate-admin-contract.mjs — the drift gate for the admin section contract.
 *
 * Cross-checks THREE sources so no admin section can silently ship untested:
 *   1. app.routes.ts        — the live Angular route tree (truth for "what routes exist")
 *   2. admin-contract.mjs    — the SSOT the sweep + DONE gate read
 *   3. admin-section-labels.ts — the label map (title/breadcrumb/a11y announce)
 *
 * FAILS THE BUILD (exit 1) when:
 *   - UNCOVERED : a live /admin/* route renders a component but has NO contract row
 *                 (→ it ships with zero convergence coverage — the exact drift that
 *                 made "sections don't come out working")
 *   - STALE     : a contract row points at a route that no longer exists in app.routes
 *   - ALIAS_DRIFT: a contract alias row's route no longer redirects
 *
 * WARNS (exit 0) when:
 *   - a redirect route has no alias row, or a hard section lacks a label entry.
 *
 * Usage:  node scripts/validate-admin-contract.mjs [--json]
 * Wire into CI + lefthook alongside validate-feature-drift.mjs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ADMIN_CONTRACT, RENDER_SECTIONS, ALIAS_SECTIONS, childPath } from '../e2e/admin-verify/admin-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES_FILE = resolve(HERE, '../frontend/src/app/app.routes.ts');
const LABELS_FILE = resolve(HERE, '../frontend/src/app/pages/admin/admin-section-labels.ts');
const JSON_OUT = process.argv.includes('--json');

/** Bracket-match the `children: [ … ]` block that belongs to `path: 'admin'`. */
function extractAdminChildrenBlock(src) {
  const adminIdx = src.indexOf("path: 'admin'");
  if (adminIdx < 0) throw new Error("could not find path: 'admin' in app.routes.ts");
  const childrenIdx = src.indexOf('children: [', adminIdx);
  if (childrenIdx < 0) throw new Error("could not find admin children: [ block");
  let i = src.indexOf('[', childrenIdx);
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) return src.slice(start + 1, i); }
  }
  throw new Error('unbalanced admin children block');
}

/** Remove nested `children: [ … ]` sub-blocks so we only read TOP-LEVEL admin child routes. */
function stripNestedChildren(block) {
  let out = block;
  for (;;) {
    const idx = out.indexOf('children: [');
    if (idx < 0) break;
    let i = out.indexOf('[', idx), depth = 0;
    for (; i < out.length; i++) {
      if (out[i] === '[') depth++;
      else if (out[i] === ']') { depth--; if (depth === 0) break; }
    }
    out = out.slice(0, idx) + out.slice(i + 1);
  }
  return out;
}

/** Strip block + line comments so a comment mentioning "redirectTo" can't misclassify a route. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Every top-level admin child route → { path, kind: 'component' | 'redirect' | 'catchall' }. */
function parseAdminRoutes(block) {
  const clean = stripNestedChildren(stripComments(block));
  const re = /path:\s*'([^']*)'/g;
  const routes = [];
  let m;
  const matches = [];
  while ((m = re.exec(clean))) matches.push({ path: m[1], at: m.index, end: re.lastIndex });
  for (let k = 0; k < matches.length; k++) {
    const seg = clean.slice(matches[k].end, matches[k + 1]?.at ?? clean.length);
    const kind = matches[k].path === '**' ? 'catchall'
      : /redirectTo/.test(seg) ? 'redirect'
      : /loadComponent/.test(seg) ? 'component'
      : 'unknown';
    routes.push({ path: matches[k].path, kind });
  }
  return routes;
}

const routesSrc = readFileSync(ROUTES_FILE, 'utf8');
const labelsSrc = readFileSync(LABELS_FILE, 'utf8');
const adminRoutes = parseAdminRoutes(extractAdminChildrenBlock(routesSrc));

const componentPaths = new Set(adminRoutes.filter((r) => r.kind === 'component').map((r) => r.path));
const redirectPaths = new Set(adminRoutes.filter((r) => r.kind === 'redirect').map((r) => r.path));

const contractRenderPaths = new Set(RENDER_SECTIONS.map((s) => childPath(s.route)));
const contractAliasPaths = new Set(ALIAS_SECTIONS.map((s) => childPath(s.route)));
// Label keys — the map mixes quoted ('editor-native':) and bare (analytics:) keys,
// comma-separated on shared lines. Scope to the object body, capture both forms.
const labelBody = (labelsSrc.match(/ADMIN_SECTION_LABELS[^=]*=\s*\{([\s\S]*?)\};/) ?? [, ''])[1];
const labelKeys = new Set(
  [...labelBody.matchAll(/(?:'([^']+)'|([A-Za-z][\w-]*))\s*:/g)].map((m) => m[1] ?? m[2]),
);

// Internal SPA redirects that intentionally have no alias contract row.
const IGNORED_REDIRECTS = new Set(['dashboard', 'classic', 'v2', '']);

const errors = [];
const warnings = [];

// 1. UNCOVERED — live component route with no contract row.
for (const p of componentPaths) {
  if (!contractRenderPaths.has(p) && !contractAliasPaths.has(p)) {
    errors.push({ kind: 'UNCOVERED', route: `/admin/${p}`, detail: 'live admin route renders a component but has NO admin-contract row → ships with zero convergence coverage' });
  }
}
// 2. STALE — contract render row points at a dead route.
for (const s of RENDER_SECTIONS) {
  const p = childPath(s.route);
  if (!componentPaths.has(p)) {
    errors.push({ kind: 'STALE', route: s.route, slug: s.slug, detail: 'contract row has no matching component route in app.routes.ts (renamed/removed?)' });
  }
}
// 3. ALIAS_DRIFT — contract alias no longer redirects.
for (const s of ALIAS_SECTIONS) {
  const p = childPath(s.route);
  if (!redirectPaths.has(p)) {
    errors.push({ kind: 'ALIAS_DRIFT', route: s.route, slug: s.slug, detail: `alias contract row expects a redirect to ${s.redirectTo}, but that path no longer redirects` });
  }
}
// 4. WARN — redirect route with no alias row (advertised-orphan risk).
for (const p of redirectPaths) {
  if (!IGNORED_REDIRECTS.has(p) && !contractAliasPaths.has(p)) {
    warnings.push({ kind: 'UNMAPPED_REDIRECT', route: `/admin/${p}`, detail: 'redirect route with no alias contract row — add one so the sweep asserts its target' });
  }
}
// 5. WARN — hard section whose route resolves to NO known label segment (title falls
//    back to 'Dashboard'). Mirrors adminSectionLabelFromPath: walk non-param segments.
for (const s of RENDER_SECTIONS) {
  if (s.severity !== 'hard') continue;
  const segs = childPath(s.route).split('/').filter((x) => x && !x.startsWith(':'));
  const covered = segs.length === 0 || segs.some((x) => labelKeys.has(x)) || labelKeys.has(s.slug);
  if (!covered) {
    warnings.push({ kind: 'MISSING_LABEL', slug: s.slug, detail: 'route resolves to no ADMIN_SECTION_LABELS segment → title falls back to Dashboard (WCAG 2.4.2)' });
  }
}

const summary = {
  routes_in_app: adminRoutes.length,
  component_routes: componentPaths.size,
  redirect_routes: redirectPaths.size,
  contract_render: RENDER_SECTIONS.length,
  contract_alias: ALIAS_SECTIONS.length,
  errors: errors.length,
  warnings: warnings.length,
};

if (JSON_OUT) {
  console.log(JSON.stringify({ meta: { routes_file: ROUTES_FILE }, summary, errors, warnings }, null, 2));
} else {
  console.log('── admin-contract drift gate ──────────────────────────────');
  console.log(`app.routes admin children: ${summary.routes_in_app} (component ${summary.component_routes} · redirect ${summary.redirect_routes})`);
  console.log(`contract rows: ${ADMIN_CONTRACT.length} (render ${summary.contract_render} · alias ${summary.contract_alias})`);
  if (errors.length) {
    console.log(`\n❌ ${errors.length} DRIFT ERROR(S):`);
    for (const e of errors) console.log(`  [${e.kind}] ${e.route ?? e.slug} — ${e.detail}`);
  }
  if (warnings.length) {
    console.log(`\n⚠️  ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  [${w.kind}] ${w.route ?? w.slug} — ${w.detail}`);
  }
  if (!errors.length) console.log('\n✅ no drift — every live admin route has a contract row; every row maps to a live route.');
}

process.exit(errors.length ? 1 : 0);
