#!/usr/bin/env node
/**
 * verify-envvars-causal.mjs — CAUSAL test for the AI env-vars mutation flow
 * (create → read-back → delete → confirm-gone) on the real e2e-test-org.
 *
 * WHY: `reconcile-surfaces.mjs` proves the env-vars DISPLAY matches the store
 * (count), but is BLIND to a broken WRITE — and env-vars is exactly where a
 * write bug lived: `ai_env_vars` CREATE once 400'd for every var (an `ON CONFLICT`
 * that didn't match a partial index — the lying-success class). This exercises the
 * full owner mutation end-to-end and asserts the row actually persisted + is then
 * actually removed, so a 2xx-that-didn't-persist (or a dropped delete) is caught
 * here, never by a read-only check. Complements verify-mutations-causal (which
 * covers site-update + MCP) — env-vars had no causal probe until now.
 *
 * Pure-API with E2E_API_KEY + `Origin` (omitting Origin trips Bot Fight). Org-scoped,
 * so no site needed. Fully self-cleaning (deletes its probe var; also sweeps any
 * stale CAUSAL_ENV_ leftovers from a prior interrupted run). Skips (exit 0) when
 * E2E_API_KEY is unset so forks + secret-less CI stay green.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-envvars-causal.mjs
 */
const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-envvars-causal skipped — E2E_API_KEY unset');
  process.exit(0);
}

const BASE = process.env.PROD_URL || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'User-Agent': UA, Origin: BASE };
const api = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
// Real response shapes (verified against prod): GET → `{ vars: [...] }`, POST → `{ var: {...} }`.
const listVars = (d) => (Array.isArray(d) ? d : (d?.vars ?? d?.data ?? []));

const results = [];
const record = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? '✅' : '🔴'} ${name} — ${detail}`);
};

const probeKey = `CAUSAL_ENV_${Date.now()}`;
let createdId = '';

try {
  // 1) CREATE — org-scoped env var. A 2xx is necessary but NOT sufficient (the
  //    lying-success class); step 2 proves it actually landed.
  const createRes = await api('/api/env-vars', {
    method: 'POST',
    body: JSON.stringify({ scope: 'org', key: probeKey, value: `probe-${Date.now()}` }),
  });
  const createBody = await createRes.json().catch(() => ({}));
  createdId = createBody?.var?.id ?? createBody?.data?.id ?? createBody?.id ?? '';
  record('create env-var', createRes.status >= 200 && createRes.status < 300, `POST → ${createRes.status}`);

  // 2) READ-BACK — the created key must appear in the list (display == store).
  const listAfterCreate = listVars(await (await api('/api/env-vars')).json());
  const found = listAfterCreate.find((v) => v?.key === probeKey);
  if (found && !createdId) createdId = found.id; // fall back to list id if POST didn't return one
  record(
    'read-back after create',
    !!found,
    found ? `key "${probeKey}" present (id=${createdId || 'n/a'})` : `key "${probeKey}" MISSING → lying-success (2xx, no persist)`,
  );

  // 3) DELETE — soft-delete the probe var.
  let delStatus = 0;
  if (createdId) {
    delStatus = (await api(`/api/env-vars/${createdId}`, { method: 'DELETE' })).status;
    record('delete env-var', delStatus >= 200 && delStatus < 300, `DELETE → ${delStatus}`);
  } else {
    record('delete env-var', false, 'no id to delete (create/read-back failed)');
  }

  // 4) CONFIRM-GONE — the deleted key must NOT reappear in the list.
  const listAfterDelete = listVars(await (await api('/api/env-vars')).json());
  const stillThere = listAfterDelete.some((v) => v?.key === probeKey);
  record('confirm gone after delete', !stillThere, stillThere ? 'key STILL present → dropped delete' : 'key removed');

  // Safety sweep: delete any stale CAUSAL_ probe rows from an interrupted run.
  for (const v of listAfterDelete) {
    if (v?.key?.startsWith('CAUSAL_') && v.id) await api(`/api/env-vars/${v.id}`, { method: 'DELETE' }).catch(() => {});
  }

  const ok = results.length === 4 && results.every(Boolean);
  console.log(`\nVERDICT: ${ok ? '✅ PASS — env-var create→read-back→delete→gone all persisted' : '🔴 FAIL — a mutation lied or dropped'}`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  // Best-effort cleanup on throw so a probe var never lingers.
  if (createdId) await api(`/api/env-vars/${createdId}`, { method: 'DELETE' }).catch(() => {});
  console.log(`🔴 verify-envvars-causal threw: ${String(e).slice(0, 140)}`);
  process.exit(1);
}
