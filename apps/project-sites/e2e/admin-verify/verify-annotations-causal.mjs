#!/usr/bin/env node
/**
 * verify-annotations-causal.mjs — CAUSAL test for the Snapshots "Timeline notes"
 * mutation (write→read-back→delete). The timeline-note control (`<app-timeline-notes>`
 * → POST /api/sites/:id/annotations → GET list → DELETE /api/annotations/:id) was
 * functionally complete but had NO causal probe — a lying-success (2xx that doesn't
 * persist) or a dropped write would be invisible to the read-only reconcile sweep.
 *
 * Pure-API on the e2e-test-org seed site (E2E_API_KEY + `Origin` header — omitting
 * Origin trips Bot Fight). The write is self-cleaning (the DELETE leg IS the cleanup,
 * so no `causal-*` rows accumulate). The endpoints are `activity_feed`-flag-gated:
 * a 404 on the initial GET means the flag is OFF for this org → skip (exit 0), never
 * false-fail. Also skips (exit 0) when E2E_API_KEY is unset so forks + secret-less CI
 * stay green.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-annotations-causal.mjs
 */
import { resolveE2ESite } from './_resolve-e2e-site.mjs';

const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-annotations-causal skipped — E2E_API_KEY unset');
  process.exit(0);
}

const BASE = process.env.PROD_URL || 'https://projectsites.dev';
let SITE_ID = process.env.CAUSAL_SITE_ID || '';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'User-Agent': UA, Origin: BASE };
const api = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
const unwrap = (d) => d?.data ?? d;

try {
  if (!SITE_ID) {
    SITE_ID = (await resolveE2ESite(BASE, KEY, UA)).id;
    if (!SITE_ID) {
      console.log('::notice:: verify-annotations-causal skipped — no site on the e2e-test-org to probe');
      process.exit(0);
    }
    console.log(`(auto-resolved CAUSAL_SITE_ID=${SITE_ID})`);
  }

  // Flag-aware skip: the endpoints are gated on `activity_feed`. A 404 here means
  // the flag is dark for this org — NOT a bug, so skip rather than false-fail.
  const listRes = await api(`/api/sites/${SITE_ID}/annotations`);
  if (listRes.status === 404) {
    console.log('::notice:: verify-annotations-causal skipped — activity_feed flag off (GET 404)');
    process.exit(0);
  }

  // ── WRITE → READ-BACK → DELETE → GONE ──────────────────────────────────────
  const note = `causal-note-${Date.now()}`;
  const date = new Date().toISOString().slice(0, 10);
  const postRes = await api(`/api/sites/${SITE_ID}/annotations`, {
    method: 'POST',
    body: JSON.stringify({ siteId: SITE_ID, date, note, category: 'other' }),
  });
  const created = unwrap(await postRes.json().catch(() => ({})));
  const id = created?.id;
  // POST → 200 or 201 Created; both are valid success codes for a create.
  const postOk = (postRes.status === 200 || postRes.status === 201) && !!id;

  const afterCreate = unwrap(await (await api(`/api/sites/${SITE_ID}/annotations`)).json().catch(() => ({}))) ?? [];
  const present = Array.isArray(afterCreate) && afterCreate.some((r) => r?.note === note);

  let delStatus = 0;
  let delOk = false;
  let gone = false;
  if (id) {
    delStatus = (await api(`/api/annotations/${id}`, { method: 'DELETE' })).status;
    // DELETE → 200 or 204 No Content; both are valid success codes for a delete.
    delOk = delStatus === 200 || delStatus === 204;
    const afterDelete = unwrap(await (await api(`/api/sites/${SITE_ID}/annotations`)).json().catch(() => ({}))) ?? [];
    gone = Array.isArray(afterDelete) && !afterDelete.some((r) => r?.note === note);
  }

  const ok = postOk && present && delOk && gone;
  console.log(
    `${ok ? '✅' : '🔴'} timeline-note write→read-back→delete — post=${postRes.status} id=${!!id} present=${present} delete=${delStatus} gone=${gone}`,
  );
  console.log(`\nVERDICT: ${ok ? '✅ PASS' : '🔴 CHECK'} — annotation mutation ${ok ? 'persisted + cleaned up' : 'did NOT round-trip'}`);
  if (!ok) console.log('   ↳ a 2xx that did not persist = lying-success; a missing read-back = dropped write.');
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
