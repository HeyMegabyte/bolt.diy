#!/usr/bin/env node
/**
 * Deploys the Angular production build to Cloudflare R2 — RELIABLY + FAST.
 * Usage: node scripts/deploy-r2.mjs [staging|production]
 * Requires CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL env vars.
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
import { exec } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { promisify } from 'util';

const pexec = promisify(exec);
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

async function putWithRetry(key, file, ct) {
  for (let a = 1; a <= 3; a++) {
    if (await put(key, file, ct)) return true;
    process.stderr.write(`  retry ${a} ${key}\n`);
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
for (const file of entries) {
  const rel = relative(DIST, file);
  const key = `marketing/${rel}`;
  const local = statSync(file).size;
  if ((await r2Size(key)) !== local) {
    process.stderr.write(`  verify-mismatch, re-PUT ${key}\n`);
    await putWithRetry(key, file, MIME[extname(file)] || 'application/octet-stream');
    if ((await r2Size(key)) !== local) failed.push(key);
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
