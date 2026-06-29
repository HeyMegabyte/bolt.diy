#!/usr/bin/env node
/**
 * deploy-admin-r2.mjs — Uploads the built Angular admin frontend to R2
 *
 * The admin frontend is built at frontend/dist/project-sites-frontend/browser/
 * and is served from R2 at the admin/ prefix so the worker serves it for
 * admin.projectsites.dev.
 *
 * Usage:
 *   node scripts/deploy-admin-r2.mjs [--env production]
 *
 * Prerequisites:
 *   CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL env vars set, or CF_API_TOKEN
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const CF_ACCOUNT_ID = '84fa0d1b16ff8086dd958c468ce7fd59';
const ENV = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'production';
const BUCKET = ENV === 'production' ? 'project-sites-production' : 'project-sites';

const CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_API_KEY;
const CLOUDFLARE_EMAIL = process.env.CLOUDFLARE_EMAIL || 'blzalewski@gmail.com';
const CF_API_TOKEN = process.env.CF_API_TOKEN;

if (!CLOUDFLARE_API_KEY && !CF_API_TOKEN) {
  console.error('[deploy-admin] Need either CLOUDFLARE_API_KEY or CF_API_TOKEN');
  process.exit(1);
}

function authHeaders() {
  if (CF_API_TOKEN) return { Authorization: `Bearer ${CF_API_TOKEN}` };
  return { 'X-Auth-Email': CLOUDFLARE_EMAIL, 'X-Auth-Key': CLOUDFLARE_API_KEY };
}

const DIST = join(import.meta.dirname, '..', 'frontend', 'dist', 'project-sites-frontend', 'browser');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

function getMimeType(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (stat.isFile() && stat.size > 0) {
      files.push({ path: fullPath, name: entry, size: stat.size });
    }
  }
  return files;
}

const R2_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${BUCKET}/objects`;

async function uploadFile(r2Key, filePath, contentType) {
  const body = readFileSync(filePath);
  const encodedKey = r2Key.split('/').map(s => encodeURIComponent(s)).join('/');
  const res = await fetch(`${R2_BASE}/${encodedKey}`, {
    method: 'PUT',
    headers: {
      ...authHeaders(),
      'Content-Type': contentType,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`[deploy-admin] FAILED ${r2Key}: ${res.status} ${text.slice(0, 200)}`);
    return false;
  }
  return true;
}

async function main() {
  const files = collectFiles(DIST);
  console.warn(`[deploy-admin] Uploading ${files.length} files from ${DIST} → R2 ${BUCKET}/admin/`);

  let uploaded = 0;
  let failed = 0;

  for (const file of files) {
    // Strip the DIST prefix to get relative path, then prefix with admin/
    const relPath = file.path.slice(DIST.length + 1);
    const r2Key = `admin/${relPath}`;
    const contentType = getMimeType(file.path);
    const ok = await uploadFile(r2Key, file.path, contentType);
    if (ok) uploaded++; else failed++;
  }

  // Also upload the prerendered-routes.json and 3rdpartylicenses.txt from parent dist
  const parentDir = join(import.meta.dirname, '..', 'frontend', 'dist', 'project-sites-frontend');
  for (const extra of ['prerendered-routes.json', '3rdpartylicenses.txt']) {
    const fullPath = join(parentDir, extra);
    try {
      const stat = statSync(fullPath);
      if (stat.isFile()) {
        const r2Key = `admin/${extra}`;
        const ct = extra.endsWith('.json') ? 'application/json' : 'text/plain';
        if (await uploadFile(r2Key, fullPath, ct)) uploaded++; else failed++;
      }
    } catch { /* skip missing */ }
  }

  console.warn(`[deploy-admin] Done: ${uploaded} uploaded, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('[deploy-admin] Fatal:', err.message);
  process.exit(1);
});
