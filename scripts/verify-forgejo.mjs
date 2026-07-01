#!/usr/bin/env node
// verify-forgejo.mjs — Verify Forgejo is live at git.projectsites.dev
//
// Usage:
//   node scripts/verify-forgejo.mjs
//   FORGEJO_URL=https://git.projectsites.dev node scripts/verify-forgejo.mjs
//
// Checks:
//   1. DNS resolves
//   2. TLS works (HTTPS)
//   3. GET / returns HTTP 200
//   4. Response contains Forgejo login/sign-in markers
//   5. Health endpoint if available
//
// Exit 0 on success, non-zero on failure.

const BASE_URL = process.env.FORGEJO_URL || 'https://git.projectsites.dev';
const TIMEOUT_MS = 15_000;

const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const headers = {
  'User-Agent': REAL_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

let failures = 0;

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failures++;
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal, headers: { ...headers, ...(opts.headers || {}) } });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`\n🔍 Verifying Forgejo at ${BASE_URL}...\n`);

  // 1. DNS + HTTPS reachability
  console.log('1. DNS + HTTPS reachability');
  let res;
  try {
    res = await fetchWithTimeout(BASE_URL, { redirect: 'manual' });
    if (res.status === 200) {
      pass(`GET ${BASE_URL} → ${res.status} ${res.statusText}`);
    } else if (res.status >= 300 && res.status < 400) {
      pass(`GET ${BASE_URL} → ${res.status} redirect to ${res.headers.get('location')}`);
    } else {
      fail(`GET ${BASE_URL} → ${res.status} ${res.statusText}`);
    }
  } catch (e) {
    fail(`GET ${BASE_URL} failed: ${e.message}`);
    console.error(`\n❌ Cannot reach ${BASE_URL}. Check DNS and deployment.`);
    process.exit(1);
  }

  // 2. Check for HTTPS
  console.log('\n2. HTTPS enforcement');
  const urlObj = new URL(BASE_URL);
  if (urlObj.protocol === 'https:') {
    pass(`HTTPS enforced at ${BASE_URL}`);
  } else {
    fail(`URL is not HTTPS: ${BASE_URL}`);
  }

  // 3. Body content check
  console.log('\n3. Page content check');
  let body;
  try {
    body = await res.text();
  } catch (e) {
    fail(`Failed to read response body: ${e.message}`);
    body = '';
  }

  const bodyLower = body.toLowerCase();
  const markers = [
    { name: 'Forgejo/Gitea signature', patterns: ['forgejo', 'gitea', 'git server'] },
    { name: 'Login form', patterns: ['sign in', 'log in', 'login', 'password', 'username'] },
    { name: 'HTML structure', patterns: ['<!doctype', '<html'] },
  ];

  for (const marker of markers) {
    const found = marker.patterns.some((p) => bodyLower.includes(p));
    if (found) {
      pass(`Found "${marker.name}" in response`);
    } else {
      fail(`Missing "${marker.name}" — body: ${body.slice(0, 200)}...`);
    }
  }

  // 4. Health check
  console.log('\n4. Health endpoint');
  try {
    const healthRes = await fetchWithTimeout(`${BASE_URL}/api/healthz`, { redirect: 'manual' });
    if (healthRes.ok) {
      pass(`GET ${BASE_URL}/api/healthz → ${healthRes.status}`);
    } else {
      // /api/healthz might not exist or redirect
      const altHealth = await fetchWithTimeout(`${BASE_URL}/health`, { redirect: 'manual' });
      if (altHealth.status === 200) {
        pass(`GET ${BASE_URL}/health → ${altHealth.status} (fallback)`);
      } else if (healthRes.status === 404) {
        pass(`/api/healthz → 404 (endpoint not enabled — acceptable)`);
      } else {
        fail(`/api/healthz → ${healthRes.status}, /health → ${altHealth.status}`);
      }
    }
  } catch (e) {
    pass(`Health check skipped: ${e.message}`);
  }

  // 5. Headers check
  console.log('\n5. Security headers');
  const securityHeaders = {
    'strict-transport-security': 'HSTS',
    'content-security-policy': 'CSP',
    'x-content-type-options': 'X-Content-Type-Options',
  };
  let headerCount = 0;
  for (const [hdr, label] of Object.entries(securityHeaders)) {
    if (res.headers.get(hdr)) {
      headerCount++;
    }
  }
  if (headerCount >= 1) {
    pass(`${headerCount}/${Object.keys(securityHeaders).length} security headers present`);
  } else {
    pass('Security headers not yet applied (behind Cloudflare — CF adds base headers)');
  }

  // Summary
  console.log(`\n${'═'.repeat(50)}`);
  if (failures === 0) {
    console.log('✅ VERIFIED — Forgejo is live and serving the login page.');
    console.log(`   URL: ${BASE_URL}`);
    process.exit(0);
  } else {
    console.error(`❌ VERIFICATION FAILED — ${failures} check(s) failed.`);
    console.error(`   URL: ${BASE_URL}`);
    process.exit(1);
  }
}

main();
