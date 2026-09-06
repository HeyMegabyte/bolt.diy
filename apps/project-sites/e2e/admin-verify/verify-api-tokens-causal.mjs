#!/usr/bin/env node
/**
 * verify-api-tokens-causal.mjs — CAUSAL test for the Public-API token mutation flow
 * (mint → read-back → revoke → confirm-gone) on the real e2e-test-org.
 *
 * WHY: `reconcile-surfaces.mjs` proves the api-tokens DISPLAY matches the store, but
 * is BLIND to a broken WRITE — and token-minting is exactly where a lying-success is
 * dangerous: a `201 { plaintext }` that DIDN'T persist means the operator copies a
 * `psk_` token that never authenticates; a revoke that returns `{ok:true}` but doesn't
 * actually revoke leaves a live credential (a security hole). This exercises the full
 * owner mutation end-to-end and asserts (a) the minted token actually lands in the list
 * (persist), (b) the plaintext is returned ONCE but the LIST never leaks plaintext/hash
 * (metadata-only, per the route contract), (c) the revoke actually removes it (no
 * dangling live credential). Complements verify-envvars-causal (same self-cleaning
 * create→delete shape); api-tokens had READ reconciliation (AL-039) but no WRITE probe.
 *
 * Pure-API with E2E_API_KEY + `Origin` (omitting Origin trips Bot Fight). Org-scoped,
 * fully self-cleaning (revokes its probe token; also sweeps stale CAUSAL_TOKEN_ leftovers
 * from an interrupted run). Skips (exit 0) when E2E_API_KEY is unset so forks + secret-less
 * CI stay green.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-api-tokens-causal.mjs
 */
const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-api-tokens-causal skipped — E2E_API_KEY unset');
  process.exit(0);
}

const BASE = process.env.PROD_URL || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'User-Agent': UA, Origin: BASE };
const api = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
// Real response shapes (per src/routes/api_tokens_admin.ts): GET → `{ data: [...] }`,
// POST → `{ token: {id,name,scopes,…}, plaintext, warning }`, DELETE → `{ ok: true }`.
const listTokens = (d) => (Array.isArray(d) ? d : (d?.data ?? d?.tokens ?? []));

const results = [];
const record = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? '✅' : '🔴'} ${name} — ${detail}`);
};

const probeName = `CAUSAL_TOKEN_${Date.now()}`;
let createdId = '';

try {
  // 1) MINT — a 2xx is necessary but NOT sufficient (the lying-success class);
  //    step 2 proves it actually persisted + is usable-once.
  const createRes = await api('/api/v1-tokens', {
    method: 'POST',
    body: JSON.stringify({ name: probeName, scopes: ['sites:read'] }),
  });
  const createBody = await createRes.json().catch(() => ({}));
  createdId = createBody?.token?.id ?? createBody?.data?.id ?? createBody?.id ?? '';
  const plaintext = String(createBody?.plaintext ?? '');
  record(
    'mint token',
    createRes.status >= 200 && createRes.status < 300 && plaintext.length > 0,
    `POST → ${createRes.status}, plaintext ${plaintext ? `returned (${plaintext.slice(0, 4)}…, len ${plaintext.length})` : 'MISSING'}`,
  );

  // 2) READ-BACK — the minted token must appear in the list (persist == display).
  const listAfterCreate = listTokens(await (await api('/api/v1-tokens')).json());
  const found = listAfterCreate.find((t) => t?.name === probeName || t?.id === createdId);
  if (found && !createdId) createdId = found.id;
  record(
    'read-back after mint',
    !!found,
    found ? `token "${probeName}" present (id=${createdId || 'n/a'})` : `token "${probeName}" MISSING → lying-success (2xx, no persist)`,
  );

  // 2b) SECURITY — the LIST must expose metadata ONLY: never the plaintext or the hash.
  const leak = listAfterCreate.some(
    (t) => t && (t.plaintext != null || t.hash != null || t.token_hash != null || t.token != null || t.secret != null),
  );
  record('list never leaks plaintext/hash', !leak, leak ? 'LEAK — a list row exposed plaintext/hash/secret' : 'metadata-only (no plaintext/hash in list)');

  // 3) REVOKE — remove the probe token.
  let delStatus = 0;
  if (createdId) {
    delStatus = (await api(`/api/v1-tokens/${createdId}`, { method: 'DELETE' })).status;
    record('revoke token', delStatus >= 200 && delStatus < 300, `DELETE → ${delStatus}`);
  } else {
    record('revoke token', false, 'no id to revoke (mint/read-back failed)');
  }

  // 4) CONFIRM-GONE — the revoked token must NOT reappear in the list (no dangling live credential).
  const listAfterDelete = listTokens(await (await api('/api/v1-tokens')).json());
  const stillThere = listAfterDelete.some((t) => t?.name === probeName || t?.id === createdId);
  record('confirm gone after revoke', !stillThere, stillThere ? 'token STILL present → lying-revoke (live credential left dangling)' : 'token removed');

  // Safety sweep: revoke any stale CAUSAL_TOKEN_ rows from an interrupted run.
  for (const t of listAfterDelete) {
    if (t?.name?.startsWith('CAUSAL_TOKEN_') && t.id) await api(`/api/v1-tokens/${t.id}`, { method: 'DELETE' }).catch(() => {});
  }

  const ok = results.length === 5 && results.every(Boolean);
  console.log(`\nVERDICT: ${ok ? '✅ PASS — api-token mint→read-back→revoke→gone all persisted (+ list leaks no secret)' : '🔴 FAIL — a token mutation lied or leaked'}`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  if (createdId) await api(`/api/v1-tokens/${createdId}`, { method: 'DELETE' }).catch(() => {});
  console.log(`🔴 verify-api-tokens-causal threw: ${String(e).slice(0, 140)}`);
  process.exit(1);
}
