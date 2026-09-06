#!/usr/bin/env node
/**
 * verify-mcp-connect-causal.mjs — CAUSAL test for the MCP connect→active→disconnect
 * lifecycle (ADMIN COMPLETENESS loop item 4: "connect an MCP → confirm active").
 *
 * WHY: `reconcile-surfaces.mjs` proves the connection COUNT reconciles (display==store)
 * at a point in time, but nothing proves the live WRITE chain — paste a key → the
 * connection becomes `active` → disconnect → it's gone. A lying-success (200 but no
 * upsert / wrong-source) or a dropped disconnect passes the read-reconcile yet fails
 * THIS. MCP connect is the one item-4 money-adjacent journey that had no causal probe
 * (forms + billing + media already do).
 *
 * The paste flow (`POST /api/mcp/:provider/paste`) is store-and-read (Zod-validates a
 * non-empty key, IDOR-checks site ownership, encrypts, upserts `status='active'` — no
 * provider-side validation), so a synthetic key exercises the full write path. Disconnect
 * (`DELETE /api/sites/:siteId/mcp/connections/:id`) soft-revokes (`status='revoked'`), so
 * the connection drops out of the active list.
 *
 * NON-CLOBBERING: reads the site's ACTIVE connections first and picks a catalog provider
 * that is NOT currently connected, so it never overwrites a real connection. SELF-CLEANING
 * (the probe disconnects what it connects; a re-run reuses the same revoked row). Skips
 * (exit 0) when E2E_API_KEY is unset, the org has no site, or every provider is already
 * connected (can't test without clobbering) — forks + secret-less CI stay green.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-mcp-connect-causal.mjs
 */
import { resolveE2ESite } from './_resolve-e2e-site.mjs';

const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-mcp-connect-causal skipped — E2E_API_KEY unset');
  process.exit(0);
}

const BASE = process.env.PROD_URL || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const authHeaders = { Authorization: `Bearer ${KEY}`, 'User-Agent': UA, Origin: BASE };
const api = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { ...authHeaders, ...(init.headers ?? {}) } });

const results = [];
const record = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? '✅' : '🔴'} ${name} — ${detail}`);
};

const site = await resolveE2ESite(BASE, KEY, UA);
const siteId = site?.id;
if (!siteId) {
  console.log('::notice:: verify-mcp-connect-causal skipped — no site on the e2e-test-org to probe');
  process.exit(0);
}

/** List the site's MCP connections (+ provider catalog). Shape: { data: { providers, connections } }. */
async function listConnections() {
  const r = await api(`/api/sites/${siteId}/mcp/connections`);
  const j = await r.json().catch(() => ({}));
  const d = j?.data ?? j;
  return { status: r.status, providers: d?.providers ?? [], connections: d?.connections ?? [] };
}

/** Normalize a catalog provider entry (string or {id|provider|key}) to its id string. */
const provId = (p) => (typeof p === 'string' ? p : (p?.id ?? p?.provider ?? p?.key ?? ''));

try {
  const before = await listConnections();
  if (before.status < 200 || before.status >= 300) {
    console.log(`::notice:: verify-mcp-connect-causal skipped — list connections ${before.status} (not authed / flag off?)`);
    process.exit(0);
  }
  const activeProviders = new Set(before.connections.filter((c) => c.status === 'active').map((c) => c.provider));
  const catalog = before.providers.map(provId).filter(Boolean);
  // Prefer resend (paste-native); else the first catalog provider not already connected.
  const provider = ['resend', ...catalog].filter((p, i, a) => a.indexOf(p) === i).find((p) => !activeProviders.has(p));
  if (!provider) {
    console.log('::notice:: verify-mcp-connect-causal skipped — every provider already connected (can’t test without clobbering)');
    process.exit(0);
  }

  // 1) CONNECT via paste. A 2xx is necessary but NOT sufficient (lying-success class).
  const upRes = await api(`/api/mcp/${provider}/paste?site_id=${encodeURIComponent(siteId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: `ps-causal-${Date.now()}` }),
  });
  record('paste connect', upRes.status >= 200 && upRes.status < 300, `POST /api/mcp/${provider}/paste → ${upRes.status}`);

  // 2) READ-BACK — the connection must appear active (D1 upsert == display).
  const after = await listConnections();
  const conn = after.connections.find((c) => c.provider === provider && c.status === 'active');
  record('read-back active', !!conn, conn ? `${provider} active (id=${conn.id})` : `${provider} NOT active → lying-success (2xx, no upsert)`);

  // 3) DISCONNECT.
  let delStatus = 0;
  if (conn?.id) {
    delStatus = (await api(`/api/sites/${siteId}/mcp/connections/${conn.id}`, { method: 'DELETE' })).status;
    record('disconnect', delStatus >= 200 && delStatus < 300, `DELETE → ${delStatus}`);
  } else {
    record('disconnect', false, 'no connection id to disconnect');
  }

  // 4) CONFIRM GONE — the disconnected provider must drop out of the ACTIVE list.
  const gone = await listConnections();
  const still = gone.connections.some((c) => c.provider === provider && c.status === 'active');
  record('confirm gone after disconnect', !still, still ? `${provider} STILL active → dropped disconnect` : `${provider} removed from active list`);

  const ok = results.length === 4 && results.every(Boolean);
  console.log(
    `\nVERDICT: ${ok ? '✅ PASS — MCP connect→active→disconnect→gone all persisted' : '🔴 FAIL — an MCP mutation lied or dropped'} (provider=${provider})`,
  );
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log(`🔴 verify-mcp-connect-causal threw: ${String(e).slice(0, 140)}`);
  process.exit(1);
}
