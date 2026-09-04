#!/usr/bin/env node
/**
 * verify-beacon-funnel-causal.mjs — CAUSAL test for the client-beacon funnel flows
 * (verify-against-source-of-truth § causal test: perform the action → assert the
 * DISPLAY the owner sees moves). `conversion`, `form_start`, `form_submit` are
 * emitted ONLY by the client beacon (POST /api/events) and mirrored into
 * `visitor_events` (see routes/analytics.ts VISITOR_MIRROR_TYPES). The existing
 * `fire-conversion.mjs` / `fire-form-event.mjs` only FIRE the events; the existing
 * analytics checks are STATIC (display-vs-count at a point in time). Neither proves
 * the live chain "a visitor converts / submits a form → the owner's conversion +
 * form-funnel numbers go up". This composes fire + before/after reconcile + assert.
 *
 * Two flows, one run (both pure-API — the beacon 202s a plain curl, unlike the
 * bot-challenged /api/contact-form + /api/v1/forms/submit):
 *   A. conversion  → GET /api/sites/:id/analytics       → traffic.conversions Δ ≥ N
 *   B. form funnel → GET /api/sites/:id/analytics/forms  → form.starts/​submits Δ ≥ 1
 *
 * Targets the e2e-test-org seed site (acme-bakery / e2e-site-1) unlocked by
 * E2E_API_KEY. A FIXED form key ('causal-beacon-form') keeps the forms[] list
 * bounded across runs (one accumulating row, delta-asserted — not a new row/run).
 * Benign test events on a throwaway site, no cleanup (fire-*.mjs norm). Skips
 * (exit 0) when E2E_API_KEY is unset so forks + secret-less CI stay green.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-beacon-funnel-causal.mjs [N]
 */

import { resolveE2ESite } from "./_resolve-e2e-site.mjs";
const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-beacon-funnel-causal skipped — E2E_API_KEY unset');
  process.exit(0);
}

const BASE = process.env.PROD_URL || 'https://projectsites.dev';
let SITE_ID = process.env.CAUSAL_SITE_ID || '';
const FORM_KEY = 'causal-beacon-form';
const N = Math.max(1, Number(process.argv[2] || 2));
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => globalThis.crypto.randomUUID();

/** Fire one beacon event (as a guest, allow-listed origin). Returns HTTP status. */
async function fire(eventType, payload) {
  const res = await fetch(`${BASE}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: BASE },
    body: JSON.stringify({
      eventId: uuid(),
      siteId: SITE_ID,
      eventType,
      timestamp: Date.now(),
      sessionId: `causal-beacon-${Date.now()}`,
      payload,
    }),
  });
  return res.status;
}

/** Owner-facing traffic.conversions. */
async function readConversions() {
  const res = await fetch(`${BASE}/api/sites/${SITE_ID}/analytics`, {
    headers: { Authorization: `Bearer ${KEY}`, 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`analytics display ${res.status} (flag off / not authed?)`);
  const t = (await res.json())?.traffic ?? {};
  return {
    conversions: Number(t.conversions ?? 0),
    hasConversionType: Array.isArray(t.byType) && t.byType.some((r) => r.type === 'conversion'),
  };
}

/** Owner-facing form-funnel counts for FORM_KEY. */
async function readForm() {
  const res = await fetch(`${BASE}/api/sites/${SITE_ID}/analytics/forms`, {
    headers: { Authorization: `Bearer ${KEY}`, 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`forms display ${res.status}`);
  const row = ((await res.json())?.forms ?? []).find((f) => f.form === FORM_KEY);
  return { starts: Number(row?.starts ?? 0), submits: Number(row?.submits ?? 0) };
}

// Resolve a REAL site id when CAUSAL_SITE_ID isn't passed (the old 'e2e-site-1'
// placeholder 404s every request → false-red). Skip gracefully if the org has none.
if (!SITE_ID) {
  SITE_ID = (await resolveE2ESite(BASE, KEY, UA)).id;
  if (!SITE_ID) {
    console.log('::notice:: verify-beacon-funnel-causal skipped — no site on the e2e-test-org to probe');
    process.exit(0);
  }
  console.log(`(auto-resolved CAUSAL_SITE_ID=${SITE_ID})`);
}

const summary = { site: SITE_ID, n: N, formKey: FORM_KEY };
try {
  const convBefore = await readConversions();
  const formBefore = await readForm();

  const convStatuses = [];
  for (let i = 0; i < N; i++) convStatuses.push(await fire('conversion', { kind: 'call', section: 'hero' }));
  const startStatus = await fire('form_start', { form: FORM_KEY });
  const submitStatus = await fire('form_submit', { form: FORM_KEY });

  await sleep(6000); // let the ctx.waitUntil() mirror writes settle

  const convAfter = await readConversions();
  const formAfter = await readForm();

  summary.conversion = {
    before: convBefore.conversions,
    after: convAfter.conversions,
    delta: convAfter.conversions - convBefore.conversions,
    fireStatuses: convStatuses,
  };
  summary.form = {
    startsBefore: formBefore.starts,
    startsAfter: formAfter.starts,
    submitsBefore: formBefore.submits,
    submitsAfter: formAfter.submits,
    fire: { start: startStatus, submit: submitStatus },
  };

  const convOk =
    convStatuses.every((s) => s === 202) &&
    summary.conversion.delta >= N &&
    convAfter.hasConversionType;
  const formOk =
    startStatus === 202 &&
    submitStatus === 202 &&
    formAfter.starts - formBefore.starts >= 1 &&
    formAfter.submits - formBefore.submits >= 1;
  const ok = convOk && formOk;

  console.log('\n=== beacon funnel CAUSAL ===\n' + JSON.stringify(summary, null, 2));
  console.log(
    `\nVERDICT: ${ok ? '✅ PASS' : '🔴 CHECK'} ` +
      `conversion Δ=${summary.conversion.delta} (want ≥${N}, type=${convAfter.hasConversionType}) · ` +
      `form starts Δ=${formAfter.starts - formBefore.starts} submits Δ=${formAfter.submits - formBefore.submits} (want ≥1)`,
  );
  if (!ok) {
    console.log(
      '   ↳ a Δ of 0 means the beacon→visitor_events mirror or the analytics read is broken ' +
        '(or analytics_rollup_read is ON and the display serves a stale rollup). Investigate.',
    );
  }
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
