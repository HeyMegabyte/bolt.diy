#!/usr/bin/env node
// validate-meta-ssot — build gate asserting the Worker's crawler-facing per-route
// meta (MARKETING_META in src/marketing_routes.ts, injected by HTMLRewriter) and
// the client SPA's PAGE_META (frontend/.../page-meta.ts, applied by MetaService)
// NEVER drift. They are two hand-maintained mirrors carrying "keep in sync"
// comments; this gate makes "in sync" enforceable — for every route present on
// BOTH sides, <title> and <meta description> must be byte-identical.
//
// Node ≥23 strips TS types on import, so we load both real modules (both are pure
// data — no Angular/worker runtime deps) instead of parsing. Run:
//   node --experimental-strip-types scripts/validate-meta-ssot.mjs
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WORKER_MAP = resolve(here, '../src/marketing_routes.ts');
const CLIENT_MAP = resolve(here, '../frontend/src/app/services/page-meta.ts');

// Client leaf-path (no leading slash) → the Worker's leading-slash key, where the
// two intentionally use different route spellings for the SAME page.
const CLIENT_TO_WORKER_ALIAS = {
  signin: '/auth/sign-in', // /signin is the app's 401-redirect target; /auth/sign-in redirects to it
};

// Worker routes the Angular router redirects elsewhere client-side (redirectTo in
// app.routes.ts). They carry NO own client PAGE_META (the router bounces before
// MetaService resolves them), so instead their SERVER meta must equal the redirect
// TARGET's server meta — otherwise the crawler indexes the alias with a title that
// differs from where the user actually lands. { workerAliasKey: workerTargetKey }.
const CLIENT_REDIRECTS = { '/classic': '/' };

/** Canonical compare-key: strip a single leading slash; '' and '/' both = home. */
const canon = (k) => (k === '/' ? '' : k.replace(/^\//, ''));

const [{ MARKETING_META }, { PAGE_META }] = await Promise.all([
  import(WORKER_MAP),
  import(CLIENT_MAP),
]);

// Index the Worker map by canonical key.
const worker = new Map();
for (const [k, v] of Object.entries(MARKETING_META)) worker.set(canon(k), { key: k, ...v });

// Walk the client map; alias where needed; compare the intersection.
const drifts = [];
const clientOnly = [];
const compared = [];
const matchedWorkerKeys = new Set();

for (const [rawKey, v] of Object.entries(PAGE_META)) {
  const workerKey = CLIENT_TO_WORKER_ALIAS[rawKey] ?? rawKey;
  const key = canon(workerKey);
  const w = worker.get(key);
  if (!w) { clientOnly.push(rawKey === '' ? '(home)' : rawKey); continue; }
  matchedWorkerKeys.add(key);
  compared.push(rawKey === '' ? '(home)' : rawKey);
  if (w.title !== v.title) {
    drifts.push({ route: rawKey || '(home)', field: 'title', worker: w.title, client: v.title });
  }
  if (w.description !== v.description) {
    drifts.push({ route: rawKey || '(home)', field: 'description', worker: w.description, client: v.description });
  }
}

// Redirect aliases: server meta must equal the redirect target's server meta.
const redirectVerified = [];
for (const [alias, target] of Object.entries(CLIENT_REDIRECTS)) {
  const a = worker.get(canon(alias));
  const t = worker.get(canon(target));
  matchedWorkerKeys.add(canon(alias)); // intentional alias — not "worker-only"
  if (!a) continue;
  if (!t) {
    drifts.push({ route: alias, field: `redirect-target ${target} missing in MARKETING_META`, worker: a.title, client: '(none)' });
    continue;
  }
  const tgt = target || '(home)';
  if (a.title !== t.title) drifts.push({ route: alias, field: `title (must equal ${tgt})`, worker: a.title, client: t.title });
  if (a.description !== t.description) drifts.push({ route: alias, field: `description (must equal ${tgt})`, worker: a.description, client: t.description });
  redirectVerified.push(`${alias} → ${tgt}`);
}

const workerOnly = [...worker.keys()].filter((k) => !matchedWorkerKeys.has(k)).map((k) => k || '(home)');

console.log(`meta-ssot: compared ${compared.length} shared route(s) — ${compared.join(', ')}`);
if (clientOnly.length) console.log(`  · client-only (no crawler meta injected — OK for app routes): ${clientOnly.join(', ')}`);
if (redirectVerified.length) console.log(`  · redirect aliases (server meta verified === target): ${redirectVerified.join(', ')}`);
if (workerOnly.length) console.log(`  · worker-only (no client PAGE_META entry — hydrated tab falls back to home title): ${workerOnly.join(', ')}`);

if (drifts.length) {
  console.error(`\n✗ meta-ssot: ${drifts.length} DRIFT(S) — server (MARKETING_META) and client (PAGE_META) disagree:`);
  for (const d of drifts) {
    console.error(`\n  ${d.route} · ${d.field}`);
    console.error(`    worker: ${JSON.stringify(d.worker)}`);
    console.error(`    client: ${JSON.stringify(d.client)}`);
  }
  console.error('\nFix: make the two identical (server MARKETING_META is the crawler source of truth).');
  process.exit(1);
}

console.log(`\n✓ meta-ssot: server and client agree on all ${compared.length} shared routes.`);
