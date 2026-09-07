#!/usr/bin/env node
/**
 * verify-webhooks-causal.mjs — CAUSAL write→read-back proof for the outbound-webhooks
 * endpoint (`/api/sites/:siteId/webhooks`). Dim-3 (TRUTHFUL MUTATIONS): a read-only
 * reconcile (AL-124 `webhooks_active`) proves the LIST is honest but says nothing about
 * whether CREATE actually persists and DELETE actually removes — a handler can return
 * `{ok:true,id}` while the row never lands (lying-success) or a delete can 200 while the
 * row stays (dropped delete). This probe exercises the full lifecycle on prod:
 *
 *   baseline GET → POST create → read-back (new id present, count+1, url matches,
 *   NO secret leaked in the list) → DELETE → confirm-gone (id absent, count back to N).
 *
 * SAFE + self-cleaning: creates ONE endpoint pointing at example.com on a LIVE owned
 * test-org site, then deletes it; a `finally` best-effort delete guarantees no orphan
 * even if an assertion throws mid-flight (matches the api-tokens/forms causal pattern).
 *
 * Flag-gated (`outbound_webhooks`): if every probed site 404s, the feature is honest-dark
 * → skip (exit 0), never a false red. Fail-open on unset E2E_API_KEY. Auto-joins
 * `run-all.mjs` via the `verify-*-causal.mjs` glob.
 *
 * Run:  E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-webhooks-causal.mjs
 */
import { resolveSecret } from './_browserbase-creds.mjs';

const KEY = resolveSecret('E2E_API_KEY');
const API = process.env.RECONCILE_API_BASE || 'https://project-sites.manhattan.workers.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { authorization: `Bearer ${KEY}`, 'user-agent': UA, Origin: 'https://projectsites.dev', 'content-type': 'application/json' };

if (!KEY) {
  console.log('::notice:: verify-webhooks-causal skipped — E2E_API_KEY unset');
  process.exit(0);
}

const j = async (res) => (res.ok || res.status === 201 ? res.json().catch(() => null) : null);
const endpointsOf = (body) => {
  const d = body?.data ?? body;
  return Array.isArray(d?.endpoints) ? d.endpoints : Array.isArray(d) ? d : [];
};
/** A listed endpoint must NEVER carry the signing secret (encrypted or not). */
const leaksSecret = (ep) => ep && (ep.secret != null || ep.secret_encrypted != null || ep.secretEncrypted != null);

async function pickWebhookEnabledSite() {
  const res = await fetch(`${API}/api/sites`, { headers: H });
  const body = await j(res);
  const sites = Array.isArray(body?.data) ? body.data : [];
  // Find a site whose webhooks endpoint is LIVE (200) — i.e. owned + flag on.
  for (const s of sites.slice(0, 6)) {
    const g = await fetch(`${API}/api/sites/${s.id}/webhooks`, { headers: H });
    if (g.status === 200) return { id: s.id, baseline: endpointsOf(await j(g)) };
    if (g.status !== 404) return { id: s.id, baseline: endpointsOf(await j(g)) }; // surface non-404 oddity
  }
  return null;
}

let createdId = null;
let siteId = null;
try {
  const site = await pickWebhookEnabledSite();
  if (!site) {
    console.log('::notice:: verify-webhooks-causal skipped — outbound_webhooks dark (404) on all probed sites / no sites');
    process.exit(0);
  }
  siteId = site.id;
  const n0 = site.baseline.length;
  const marker = `https://example.com/ps-e2e-webhook-${KEY.slice(-6)}-${n0}`;

  // 1) CREATE
  const createRes = await fetch(`${API}/api/sites/${siteId}/webhooks`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ url: marker, eventTypes: ['form.submitted'] }),
  });
  const created = await j(createRes);
  createdId = created?.id ?? null;
  const createOk = createRes.status === 201 && !!createdId && typeof created?.secret === 'string' && created.secret.length > 0;

  // 2) READ-BACK
  const back = endpointsOf(await j(await fetch(`${API}/api/sites/${siteId}/webhooks`, { headers: H })));
  const found = back.find((e) => e.id === createdId);
  const readBackOk = !!found && back.length === n0 + 1 && found.url === marker;
  const noSecretLeak = back.every((e) => !leaksSecret(e));

  // 3) DELETE
  const delRes = await fetch(`${API}/api/sites/${siteId}/webhooks/${createdId}`, { method: 'DELETE', headers: H });
  const delOk = delRes.ok;

  // 4) CONFIRM-GONE
  const after = endpointsOf(await j(await fetch(`${API}/api/sites/${siteId}/webhooks`, { headers: H })));
  const goneOk = !after.some((e) => e.id === createdId) && after.length === n0;
  if (goneOk) createdId = null; // cleaned — skip the finally delete

  const ok = createOk && readBackOk && noSecretLeak && delOk && goneOk;
  console.log('\n=== WEBHOOKS causal (create→read-back→delete→gone) ===');
  console.log(`  site ${siteId}  baseline=${n0}`);
  console.log(`  ${createOk ? '✓' : '✗'} create 201 + id + secret-once`);
  console.log(`  ${readBackOk ? '✓' : '✗'} read-back: new id present, count ${n0}→${n0 + 1}, url matches`);
  console.log(`  ${noSecretLeak ? '✓' : '✗'} list leaks NO signing secret`);
  console.log(`  ${delOk ? '✓' : '✗'} delete ok`);
  console.log(`  ${goneOk ? '✓' : '✗'} confirm-gone: id absent, count back to ${n0}`);
  console.log(`\nVERDICT: ${ok ? '✅ PASS' : '🔴 FAIL'} — webhook create/delete ${ok ? 'persist truthfully (no lying-success / dropped write / secret leak)' : 'FAILED (see ✗ above)'}`);
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
} finally {
  // Best-effort cleanup: if we created a row but didn't confirm it gone, delete it now.
  if (createdId && siteId) {
    try {
      await fetch(`${API}/api/sites/${siteId}/webhooks/${createdId}`, { method: 'DELETE', headers: H });
      console.log(`  ↳ cleanup: deleted leftover test webhook ${createdId}`);
    } catch {
      /* best-effort */
    }
  }
}
