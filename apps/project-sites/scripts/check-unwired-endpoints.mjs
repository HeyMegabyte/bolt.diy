#!/usr/bin/env node
/**
 * check-unwired-endpoints.mjs — "Save failed 404" regression detector.
 *
 * Caps the 2026-08-02 admin-verification arc: after finding + wiring two admin
 * features whose frontend called a worker route that DID NOT EXIST (P0.20
 * `PATCH /api/admin/profile` → 404 on every display-name save; P0.21
 * `GET/PUT /api/voice/mcp-attachments` → the voice MCPs tab's "Save failed"),
 * this gate prevents the class from recurring: every `/api/*` path the Angular
 * admin calls MUST resolve to a registered worker route.
 *
 * Heuristic (per validator-precision-discipline — prefers false-negatives):
 *   - Collect every worker route registration `.get|post|put|patch|delete|all|on('/…')`
 *     across `src/` + `libs/` (comment lines skipped), normalized to a SHAPE
 *     (`:param` / `${expr}` segments → `*`).
 *   - Collect every FE call `api.<m>('/x')` (ApiService prepends `/api`) and
 *     `http.<m>('/api/x')` (raw, full path) across `frontend/src/app`
 *     (comment lines skipped; fully-dynamic variable paths skipped).
 *   - FLAG any FE `/api/*` shape with no matching worker shape.
 *
 * Exit 0 (report-only / soft-info) by default; pass `--ci` to exit 1 on any
 * finding (surface is stable at zero as of the arc close). `--json` for machine.
 *
 * Usage: node scripts/check-unwired-endpoints.mjs [--ci] [--json]
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const FE_DIR = join(APP_DIR, 'frontend', 'src', 'app');
const WORKER_DIRS = [join(APP_DIR, 'src'), join(APP_DIR, 'libs')];

/** FE `/api/*` shapes intentionally handled outside the scanned worker dirs (none today). */
const EXEMPT_SHAPES = new Set();

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !/\.(spec|test|d)\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** True when the match at `index` sits on a comment line (JSDoc `*`, `//`, `/*`). */
function onCommentLine(src, index) {
  const lineStart = src.lastIndexOf('\n', index) + 1;
  const trimmed = src.slice(lineStart, index).trimStart();
  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*');
}

/** Normalize a path to a shape: drop query/hash, dynamic segments → '*'. */
function shape(path) {
  const p = path.split('?')[0].split('#')[0];
  if (!p.startsWith('/')) return null;
  return p
    .split('/')
    .map((seg) => (seg.includes('${') || seg.startsWith(':') ? '*' : seg))
    .join('/');
}

// ── Worker routes ──
const workerShapes = new Set();
let workerCount = 0;
const routeRe = /\.(get|post|put|patch|delete|all|on)\(\s*[`'"]([^`'"]+)[`'"]/g;
for (const dir of WORKER_DIRS) {
  for (const f of walk(dir)) {
    const src = readFileSync(f, 'utf8');
    let m;
    while ((m = routeRe.exec(src))) {
      if (onCommentLine(src, m.index)) continue;
      const raw = m[2];
      if (!raw.startsWith('/')) continue;
      const s = shape(raw);
      if (s) {
        workerShapes.add(s);
        workerCount++;
      }
    }
  }
}

// ── FE calls ──
const feCallRe = /\b(api|http)\.(get|post|put|patch|delete)\(\s*([`'"])([^`'"]*)\3/g;
const flagged = [];
const seen = new Set();
for (const f of walk(FE_DIR)) {
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = feCallRe.exec(src))) {
    if (onCommentLine(src, m.index)) continue;
    const kind = m[1];
    const method = m[2].toUpperCase();
    let path = m[4];
    if (!path) continue; // fully-dynamic variable path — unresolvable statically
    if (kind === 'api') path = '/api' + path;
    if (!path.startsWith('/api')) continue;
    const s = shape(path);
    if (!s || EXEMPT_SHAPES.has(s)) continue;
    if (!workerShapes.has(s)) {
      const key = method + ' ' + s;
      if (!seen.has(key)) {
        seen.add(key);
        flagged.push({ method, shape: s, file: f.replace(FE_DIR + '/', '') });
      }
    }
  }
}

const ci = process.argv.includes('--ci');
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ worker_routes: workerCount, worker_shapes: workerShapes.size, unwired: flagged }, null, 2));
  process.exit(ci && flagged.length ? 1 : 0);
}

if (flagged.length === 0) {
  console.log(`✅ check-unwired-endpoints: clean — every FE /api call resolves (${workerShapes.size} worker route shapes).`);
  process.exit(0);
}
console.log(`⚠️  check-unwired-endpoints: ${flagged.length} FE call(s) to a route with NO worker handler:`);
for (const f of flagged) {
  console.log(`   FAIL ${f.method.padEnd(6)} ${f.shape.padEnd(46)} ${f.file} — wire the worker route or fix the FE path`);
}
process.exit(ci ? 1 : 0);
