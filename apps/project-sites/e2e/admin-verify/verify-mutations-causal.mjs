#!/usr/bin/env node
/**
 * verify-mutations-causal.mjs — CAUSAL tests for admin MUTATIONS (write→read-back).
 *
 * READ reconciliation (`reconcile-surfaces.mjs`) proves the display matches the store,
 * but is BLIND to broken WRITES — and mutations are exactly where the bugs were:
 * iter 77 `ai_env_vars` CREATE 400'd for every var, iter 78 `flag_overrides` toggle was
 * a lying-success (both: `ON CONFLICT` not matching a PARTIAL index). This exercises the
 * owner mutation flows end-to-end and asserts the write actually persisted — a
 * lying-success (2xx that didn't persist) or a broken write is caught here, never by a
 * read-only check.
 *
 * Pure-API on the e2e-test-org seed site (E2E_API_KEY + `Origin` header — omitting Origin
 * trips Bot Fight). Every mutation is self-cleaning (restore / soft-revoke; the MCP row is
 * reused across runs via UNIQUE(site_id,provider) so it never accumulates). Skips (exit 0)
 * when E2E_API_KEY is unset so forks + secret-less CI stay green.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-mutations-causal.mjs
 */

const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-mutations-causal skipped — E2E_API_KEY unset');
  process.exit(0);
}

const BASE = process.env.PROD_URL || 'https://projectsites.dev';
const SITE_ID = process.env.CAUSAL_SITE_ID || 'e2e-site-1';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'User-Agent': UA, Origin: BASE };

const api = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
const unwrap = (d) => d?.data ?? d;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '🔴'} ${name} — ${detail}`);
};

try {
  // ── A. site UPDATE round-trip (PATCH persists + restores) ──────────────────
  {
    const orig = unwrap(await (await api(`/api/sites/${SITE_ID}`)).json())?.business_name ?? '';
    const probe = `MUT-PROBE-${Date.now()}`;
    const patchStatus = (await api(`/api/sites/${SITE_ID}`, { method: 'PATCH', body: JSON.stringify({ business_name: probe }) })).status;
    const after = unwrap(await (await api(`/api/sites/${SITE_ID}`)).json())?.business_name ?? '';
    // Restore regardless of outcome (never leave the seed mutated).
    await api(`/api/sites/${SITE_ID}`, { method: 'PATCH', body: JSON.stringify({ business_name: orig }) });
    const restored = unwrap(await (await api(`/api/sites/${SITE_ID}`)).json())?.business_name ?? '';
    record(
      'site-update PATCH persists + restores',
      patchStatus === 200 && after === probe && restored === orig,
      `patch=${patchStatus} persisted=${after === probe} restored=${restored === orig}`,
    );
  }

  // ── B. MCP paste-connect → read-active → disconnect → read-revoked ─────────
  {
    const connStatus = (await api(`/api/mcp/resend/paste?site_id=${SITE_ID}`, { method: 'POST', body: JSON.stringify({ api_key: `mut-probe-${Date.now()}` }) })).status;
    const listActive = unwrap(await (await api('/api/mcp/connections')).json());
    const activeRow = (Array.isArray(listActive) ? listActive : []).find((x) => x.provider === 'resend' && x.site_id === SITE_ID);
    const isActive = activeRow?.status === 'active';

    let delStatus = 0;
    let isRevoked = false;
    if (activeRow?.id) {
      delStatus = (await api(`/api/sites/${SITE_ID}/mcp/connections/${activeRow.id}`, { method: 'DELETE' })).status;
      const listAfter = unwrap(await (await api('/api/mcp/connections')).json());
      const row = (Array.isArray(listAfter) ? listAfter : []).find((x) => x.provider === 'resend' && x.site_id === SITE_ID);
      isRevoked = row?.status === 'revoked';
    }
    record(
      'mcp connect (active) → disconnect (revoked)',
      connStatus === 200 && isActive && delStatus === 200 && isRevoked,
      `connect=${connStatus} active=${isActive} delete=${delStatus} revoked=${isRevoked}`,
    );
  }

  const ok = results.every((r) => r.ok);
  console.log(`\nVERDICT: ${ok ? '✅ PASS' : '🔴 CHECK'} — ${results.filter((r) => r.ok).length}/${results.length} mutation flows persisted`);
  if (!ok) console.log('   ↳ a 2xx that did not persist = lying-success (the class that hit env-vars + flag_overrides).');
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
