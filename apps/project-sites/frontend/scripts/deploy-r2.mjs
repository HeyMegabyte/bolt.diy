#!/usr/bin/env node
/**
 * Deploys the Angular production build to Cloudflare R2 — RELIABLY + FAST.
 * Usage: node scripts/deploy-r2.mjs [staging|production]
 * Auth: needs CLOUDFLARE_API_TOKEN (r2 object ops) + CLOUDFLARE_API_KEY +
 * CLOUDFLARE_EMAIL (REST purge). Auto-pulled from get-secret if not in env.
 *
 * Hardening history:
 *  - per-file PUT with up to 3 retries
 *  - post-upload SIZE VERIFY of the entry files (index.html + main/styles/
 *    polyfills) — the catastrophic-if-empty objects (the 1-byte-corruption
 *    class). Other files rely on retry + a single controlled run.
 *  - automatic Cloudflare cache purge at the end.
 *  - 2026-05-30: PARALLEL uploads (concurrency pool, default 8) — turns a
 *    ~18-min sequential `wrangler`-per-file deploy into ~2 min. Concurrency is
 *    of DISTINCT keys within ONE controlled run (never overlapping deploys —
 *    that, plus mid-flight kills, was the original corruption cause; do NOT run
 *    two deploys at once or interrupt this one).
 */
import { exec, execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { promisify } from 'util';

const pexec = promisify(exec);

// Auth bootstrap. `wrangler r2 object put/get` REQUIRES CLOUDFLARE_API_TOKEN in
// env — it does NOT accept CLOUDFLARE_API_KEY+EMAIL for r2 object ops (those
// only authenticate the REST purge_cache call below). When the token is unset,
// every upload silently fails with a non-interactive-env error and the deploy
// looks "complete" while R2 holds nothing. That was the root cause of a
// multi-round phantom-corruption deploy thrash (2026-06-01). So: if any of the
// three creds are missing from env, pull them from the local secret store here
// — callers can't forget anymore.
const GET_SECRET = '/Users/Apple/.local/bin/get-secret';
for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL']) {
  if (process.env[k]) continue;
  try {
    const v = execSync(`${GET_SECRET} ${k}`, { encoding: 'utf8' }).trim();
    if (v && !v.startsWith('The file')) process.env[k] = v;
  } catch {
    /* secret unavailable — the explicit check below surfaces the gap */
  }
}
if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error(
    '✘ CLOUDFLARE_API_TOKEN not set and not in get-secret — wrangler r2 uploads will fail. Aborting.',
  );
  process.exit(1);
}
const env = process.argv[2] || 'production';
const BUCKET = env === 'staging' ? 'project-sites-staging' : 'project-sites-production';
const DIST = join(import.meta.dirname, '..', 'dist', 'project-sites-frontend', 'browser');
const ZONE_ID = '75a6f8d5e441cd7124552976ba894f83';
const CONCURRENCY = Number(process.env.DEPLOY_CONCURRENCY ?? 8);

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

async function put(key, file, ct) {
  try {
    await pexec(
      `npx wrangler r2 object put "${BUCKET}/${key}" --file "${file}" --content-type "${ct}" --remote`,
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return true;
  } catch {
    return false;
  }
}

async function r2Size(key) {
  try {
    const { stdout } = await pexec(`npx wrangler r2 object get "${BUCKET}/${key}" --remote --pipe`, {
      maxBuffer: 64 * 1024 * 1024, encoding: 'buffer',
    });
    return stdout.length;
  } catch {
    return -1;
  }
}

// Retries with EXPONENTIAL BACKOFF + jitter between attempts. Instant retries
// (the old behaviour) all fire inside the same R2 hiccup and fail together —
// a multi-second blip exhausted all 3 and dropped files (e.g. the 8 monaco
// chunks on 2026-06-07, which needed a manual full re-run). Spacing 4 attempts
// over ~3.5s rides out a transient blip. The success path adds ZERO delay
// (the first `put` returns immediately), so a healthy deploy is unaffected.
async function putWithRetry(key, file, ct, attempts = 4) {
  for (let a = 1; a <= attempts; a++) {
    if (await put(key, file, ct)) return true;
    if (a < attempts) {
      const delay = Math.min(2 ** (a - 1) * 500, 4000) + Math.floor(Math.random() * 250);
      process.stderr.write(`  retry ${a}/${attempts - 1} in ${delay}ms: ${key}\n`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return false;
}

/** Run async tasks with a fixed concurrency cap. */
async function pool(items, limit, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

const files = walk(DIST);
console.warn(`Deploying ${files.length} files to ${BUCKET} (concurrency ${CONCURRENCY})`);

let done = 0;
const failed = [];
await pool(files, CONCURRENCY, async (file) => {
  const rel = relative(DIST, file);
  const key = `marketing/${rel}`;
  const ct = MIME[extname(file)] || 'application/octet-stream';
  const ok = await putWithRetry(key, file, ct);
  done++;
  if (ok) process.stderr.write(`  [${done}/${files.length}] ${key}\n`);
  else { failed.push(key); console.error(`  FAILED (3x): ${key}`); }
});

console.warn(`\nUploaded ${files.length - failed.length}/${files.length}${failed.length ? ` — ${failed.length} FAILED` : ''}`);

// Verify the catastrophic-if-empty entry files; re-PUT once if wrong.
const entries = files.filter((f) => {
  const r = relative(DIST, f);
  return r === 'index.html' || /^(main|polyfills|styles)-/.test(r);
});
// r2Size reads back over the network and can transiently mismatch under R2
// eventual consistency — a single read was false-failing correct uploads
// ("Deploy incomplete" + exit 1) and triggered needless re-PUT churn. Confirm
// a mismatch across a few spaced reads before re-PUTting, and again before
// declaring a genuine failure.
async function sizeMatches(key, local, tries = 4) {
  for (let t = 0; t < tries; t++) {
    if ((await r2Size(key)) === local) return true;
    if (t < tries - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}
for (const file of entries) {
  const rel = relative(DIST, file);
  const key = `marketing/${rel}`;
  const local = statSync(file).size;
  if (!(await sizeMatches(key, local))) {
    process.stderr.write(`  verify-mismatch, re-PUT ${key}\n`);
    await putWithRetry(key, file, MIME[extname(file)] || 'application/octet-stream');
    if (!(await sizeMatches(key, local))) failed.push(key);
  }
}
if (failed.length) {
  console.error('Deploy incomplete — failed:', failed.join(', '));
  process.exit(1);
}

const apiKey = process.env.CLOUDFLARE_API_KEY;
const email = process.env.CLOUDFLARE_EMAIL;
if (env === 'production' && apiKey && email) {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: { 'X-Auth-Email': email, 'X-Auth-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ purge_everything: true }),
    });
    const j = await res.json();
    console.warn(j.success ? 'CDN cache purged.' : `Purge failed: ${JSON.stringify(j.errors)}`);
  } catch (e) {
    console.warn(`Purge error (deploy still succeeded): ${e.message}`);
  }
}
console.warn('Deploy complete.');
