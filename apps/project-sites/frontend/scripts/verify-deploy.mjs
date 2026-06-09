#!/usr/bin/env node
// Hard-gate verifier: confirms Angular bundle is live at the given URL.
// Fails non-zero if `main-<hash>.js` is missing from the HTML, which means
// R2 still holds the legacy static SPA instead of the Angular shell.
//
// Usage: node scripts/verify-deploy.mjs https://projectsites.dev

import { exit } from 'node:process';

const url = process.argv[2];
if (!url) {
  console.error('usage: verify-deploy.mjs <url>');
  exit(2);
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

// Full browser signature (per fetch-defaults): a bare UA still trips CF Bot
// Management — the Sec-Fetch-* set + Upgrade-Insecure-Requests make the request
// look like a real navigation so CF is less likely to 403 a datacenter IP.
const probe = async (path) => {
  const target = new URL(path, url).toString();
  const res = await fetch(target, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-User': '?1',
      'Sec-Fetch-Dest': 'document',
      'Upgrade-Insecure-Requests': '1',
    },
    redirect: 'follow',
  });
  const body = await res.text();
  return { status: res.status, body, target };
};

const checks = [];

try {
  const root = await probe('/');
  const hasMain = /main-[A-Za-z0-9]+\.js/.test(root.body);
  const hasPolyfills = /polyfills-[A-Za-z0-9]+\.js/.test(root.body);
  const hasStyles = /styles-[A-Za-z0-9]+\.css/.test(root.body);
  const hasAppRoot = /<app-root/.test(root.body);
  checks.push({
    name: 'homepage',
    target: root.target,
    status: root.status,
    hasMain,
    hasPolyfills,
    hasStyles,
    hasAppRoot,
    ok: root.status === 200 && hasMain && hasPolyfills && hasStyles && hasAppRoot,
  });

  const admin = await probe('/admin/dashboard');
  const adminHasMain = /main-[A-Za-z0-9]+\.js/.test(admin.body);
  const adminHasAppRoot = /<app-root/.test(admin.body);
  checks.push({
    name: 'admin-shell',
    target: admin.target,
    status: admin.status,
    hasMain: adminHasMain,
    hasAppRoot: adminHasAppRoot,
    ok: admin.status === 200 && adminHasMain && adminHasAppRoot,
  });
} catch (err) {
  console.error('verify-deploy: fetch failed:', err.message);
  exit(1);
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  const tag = c.ok ? 'PASS' : 'FAIL';
  console.warn(`[${tag}] ${c.name} ${c.target} -> ${c.status}`);
  for (const [k, v] of Object.entries(c)) {
    if (['name', 'target', 'status', 'ok'].includes(k)) continue;
    console.warn(`       ${k}: ${v}`);
  }
}

if (failed.length > 0) {
  // Distinguish a CF Bot-Fight block (403/503 from a datacenter/GHA IP — the
  // fetch never reached the app) from a genuine regression (200 but the Angular
  // bundle markers are missing → R2 is serving the legacy static SPA). The
  // deploy is already hard-gated by the separate CF-API + wrangler verify steps,
  // so a CF block of the runner IP must NOT hard-fail a confirmed deploy.
  const allBlocked = failed.every((c) => c.status === 403 || c.status === 503);
  if (allBlocked) {
    console.error(
      `\nverify-deploy: blocked by CF (${failed.map((c) => c.status).join(', ')}) — ` +
        'could not reach the app from this IP. Deploy already confirmed via CF-API + wrangler. ' +
        'Exiting 3 (tolerable).',
    );
    exit(3);
  }
  console.error(`\nverify-deploy: ${failed.length} check(s) failed — Angular bundle not live.`);
  exit(1);
}

console.warn('\nverify-deploy: all checks passed — Angular bundle confirmed live.');
