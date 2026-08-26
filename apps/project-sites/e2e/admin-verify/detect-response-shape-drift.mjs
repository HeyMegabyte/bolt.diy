#!/usr/bin/env node
/**
 * detect-response-shape-drift.mjs — catches the class that broke 3 admin surfaces
 * during the 2026-08 route-decomposition arc: an Angular `api.get` consumer declares
 * a top-level response key the worker no longer returns, so the value is silently
 * `undefined` → null/empty/error-fallback UI.
 *
 *   • billing  — read r.data.url; worker returns { data: { checkout_url } }        (d1ade8d7)
 *   • site-detail title — read res.site; worker returns { data: {…,business_name} } (c51167f4)
 *   • snapshots tab     — read res.snapshots; worker returns { data:[], git_history }(a237b22a)
 *
 * Every one shipped GREEN because the unit test mocked the WRONG shape. This tool
 * verifies against the LIVE worker instead: it parses each FE `.get<{ KEY: … }>('PATH')`,
 * resolves `${…}` → a real site id, curls the endpoint (Bearer E2E_API_KEY), and flags
 * any 200-JSON-object whose top-level keys omit KEY. Re-run after each route-refactor
 * installment.
 *
 * Usage:  E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/detect-response-shape-drift.mjs [siteId]
 * Exit:   0 = no drift (or E2E_API_KEY unset → skip, fail-open); 1 = drift found.
 *
 * Coverage note: GET consumers only (POST/PATCH response reads — e.g. billing
 * checkout — aren't safely curlable and are out of scope). Endpoints that 4xx on a
 * bare probe (need query params, operator-only) are skipped, not failed.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const KEY = process.env.E2E_API_KEY || '';
if (!KEY) { console.log('::notice:: detect-response-shape-drift skipped — E2E_API_KEY unset'); process.exit(0); }
const SID = process.argv[2] || 'b41e1eb9-e732-474b-9fc5-281ad4ef1ae2';
const BASE = process.env.PROD_URL || 'https://projectsites.dev';
const FE = new URL('../../frontend/src/app', import.meta.url).pathname;

const files = [];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) files.push(p);
  }
};
for (const d of ['pages/admin', 'components', 'services']) walk(`${FE}/${d}`);

// .get<{ KEY: … }>('PATH')  — KEY = first top-level identifier, PATH = string/template literal.
const re = /\.get<\{\s*([a-zA-Z_]\w*)\s*:[\s\S]*?\}>\(\s*[`'"]([^`'"]+)[`'"]/g;
const seen = new Set();
const consumers = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = re.exec(src)) !== null) {
    let path = m[2].replace(/\$\{[^}]*\}/g, SID);
    if (path.includes('${') || !path.startsWith('/')) continue;
    if (!path.startsWith('/api')) path = '/api' + path;
    const idk = `${path}::${m[1]}`;
    if (seen.has(idk)) continue;
    seen.add(idk);
    consumers.push({ key: m[1], path, file: f.replace(FE + '/', '') });
  }
}

console.log(`Parsed ${consumers.length} unique GET consumers. Probing ${BASE} live…\n`);
const drifts = [];
let checked = 0, skipped = 0;
for (const c of consumers) {
  let code = '0', topKeys = null;
  try {
    code = execSync(`/usr/bin/curl -s -o /tmp/_drift.json -w '%{http_code}' -H "Authorization: Bearer ${KEY}" "${BASE}${c.path}"`, { encoding: 'utf8' }).trim();
    if (code === '200') {
      try { const j = JSON.parse(readFileSync('/tmp/_drift.json', 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) topKeys = Object.keys(j); } catch { /* non-json */ }
    }
  } catch { /* curl err */ }
  if (topKeys) {
    checked++;
    if (!topKeys.includes(c.key)) {
      drifts.push({ ...c, topKeys });
      console.log(`🔴 DRIFT  ${c.path}\n         FE reads res.${c.key} · worker returns {${topKeys.join(', ')}} · ${c.file}`);
    }
  } else skipped++;
}
console.log(`\n=== ${drifts.length} drift · ${checked} checked (200 JSON object) · ${skipped} skipped (non-200/params/non-object) ===`);
process.exit(drifts.length > 0 ? 1 : 0);
