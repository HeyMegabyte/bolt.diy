#!/usr/bin/env node
/**
 * verify-billing-full-flow.mjs — COMPLETION § B.5: the billing FULL flow, proven end-to-end
 * over its headless-verifiable envelope on PROD. B.4 already proves the embedded checkout
 * IFRAME MOUNTS; this proves the rest of the money flow that a real prospect touches — WITHOUT
 * the one leg that cannot run headless.
 *
 * ⚠️ PROD STRIPE IS LIVE-MODE (verified 2026-09-07: checkout returns `cs_live_…` + `pk_live_…`).
 * So the POSITIVE completion leg — enter a card → `checkout.session.completed` webhook →
 * subscription flips `active` → entitlements unlock — CANNOT be driven headless on prod: a test
 * card (4242…) is rejected in live mode, and a real card is a forbidden irreversible charge
 * (`autonomous-engineering` approval-required). That leg is covered by the webhook handler's
 * unit tests, not headless-on-prod. This is the same shape as B.7's "emailed-click token
 * consumption needs a human inbox — out of headless scope." Everything ELSE is proven here:
 *
 *   Leg 1 — CHECKOUT SESSION CREATE (server half live): POST /api/billing/embedded-checkout →
 *           200 + a `cs_`-prefixed client_secret + a `pk_`-prefixed publishable key. A broken
 *           session-create is a direct revenue outage (free users can't even start to subscribe).
 *   Leg 2 — WEBHOOK SIGNATURE ENFORCED (unspoofable): POST /webhooks/stripe unsigned AND with a
 *           bad signature → 400/401 rejected. The money flow can't be flipped by a forged event.
 *   Leg 3 — CAUSAL INTEGRITY (rejected ≠ mutated): after the spoof attempts, the subscription is
 *           STILL `free` — the rejected events did NOT flip state (401 is real, not cosmetic).
 *   Leg 4 — ENTITLEMENTS HONESTLY LOCKED (pre-unlock baseline, display==store): GET
 *           /api/billing/entitlements returns the free-plan locks (analytics off, 0 custom
 *           domains, 1 seat, no custom endpoints) — the "before" the unlock would change.
 *   Leg 5 — BILLING PORTAL LIVE (manage/cancel surface): POST /api/billing/portal → 200 + a
 *           `https://billing.stripe.com/…` portal_url.
 *
 * No charge, no residue: Checkout + Portal Sessions with no card entered are free and auto-expire
 * Stripe-side (nothing lands in our D1); the webhook posts are REJECTED (no mutation). Pure-API on
 * prod via the workers.dev origin (bypasses CF bot-challenge) + Origin header (avoids Bot Fight).
 * Fail-open (exit 0) when E2E_API_KEY is unset. Seeds nothing persistent. E2E_API_KEY from ENV.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-billing-full-flow.mjs
 */
const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-billing-full-flow skipped — E2E_API_KEY unset');
  process.exit(0);
}

const API = process.env.API_ORIGIN || 'https://project-sites.manhattan.workers.dev';
const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'User-Agent': UA, Origin: ORIGIN };
const api = (path, init = {}) =>
  fetch(`${API}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(25000) });

try {
  const rows = [];
  let fails = 0;
  const check = (label, ok, detail) => {
    rows.push({ label, ok, detail });
    if (!ok) fails++;
  };

  // Leg 1 — checkout session create (server half of the money flow is live + well-formed).
  const coRes = await api('/api/billing/embedded-checkout', {
    method: 'POST',
    body: JSON.stringify({ plan: 'pro', return_url: `${ORIGIN}/admin/billing` }),
  });
  const coData = (await coRes.json().catch(() => ({})))?.data ?? {};
  const cs = String(coData.client_secret ?? '');
  const pk = String(coData.publishable_key ?? '');
  const liveMode = cs.startsWith('cs_live_') || pk.startsWith('pk_live_');
  check(
    'checkout session create → 200 + cs_/pk_',
    coRes.status === 200 && /^cs_(live|test)_/.test(cs) && /^pk_(live|test)_/.test(pk),
    `http=${coRes.status} cs=${cs.slice(0, 8)} pk=${pk.slice(0, 8)} mode=${liveMode ? 'LIVE' : 'test'}`,
  );

  // Leg 2 — webhook signature enforced (the money flow can't be flipped by a forged event).
  const spoofBody = JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_probe_forged', customer: coData.customer ?? 'cus_probe', mode: 'subscription' } },
  });
  const unsigned = await api('/webhooks/stripe', {
    method: 'POST',
    headers: { Authorization: undefined },
    body: spoofBody,
  });
  const badSig = await api('/webhooks/stripe', {
    method: 'POST',
    headers: { Authorization: undefined, 'Stripe-Signature': 't=123,v1=deadbeefdeadbeef' },
    body: spoofBody,
  });
  check('webhook UNSIGNED rejected (400/401)', unsigned.status === 400 || unsigned.status === 401, `http=${unsigned.status}`);
  check('webhook BAD-SIG rejected (400/401)', badSig.status === 400 || badSig.status === 401, `http=${badSig.status}`);

  // Leg 3 — causal integrity: the rejected spoofs did NOT flip the subscription.
  const subRes = await api('/api/billing/subscription');
  const sub = (await subRes.json().catch(() => ({})))?.data ?? {};
  check(
    'subscription STILL free after spoof (rejected ≠ mutated)',
    subRes.status === 200 && sub.plan === 'free' && !sub.stripe_subscription_id,
    `plan=${sub.plan} sub_id=${sub.stripe_subscription_id ?? 'null'}`,
  );

  // Leg 4 — entitlements honestly locked at free (the pre-unlock baseline; display==store).
  const entRes = await api('/api/billing/entitlements');
  const ent = (await entRes.json().catch(() => ({})))?.data ?? {};
  const lockedAtFree =
    ent.plan === 'free' &&
    ent.analyticsEnabled === false &&
    ent.customEndpoints === false &&
    Number(ent.maxCustomDomains) === 0 &&
    Number(ent.maxTeamSeats) === 1;
  check(
    'entitlements honestly LOCKED at free (pre-unlock baseline)',
    entRes.status === 200 && lockedAtFree,
    `plan=${ent.plan} analytics=${ent.analyticsEnabled} domains=${ent.maxCustomDomains} seats=${ent.maxTeamSeats} endpoints=${ent.customEndpoints}`,
  );

  // Leg 5 — billing portal live (the manage/cancel-subscription surface).
  const portalRes = await api('/api/billing/portal', {
    method: 'POST',
    body: JSON.stringify({ return_url: `${ORIGIN}/admin/billing` }),
  });
  const portalUrl = String(((await portalRes.json().catch(() => ({})))?.data ?? {}).portal_url ?? '');
  check(
    'billing portal → live billing.stripe.com URL',
    portalRes.status === 200 && portalUrl.startsWith('https://billing.stripe.com/'),
    `http=${portalRes.status} url=${portalUrl.slice(0, 34)}`,
  );

  for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label.padEnd(48)} ${r.detail}`);
  const ok = fails === 0;
  console.log(
    `\nVERDICT: ${ok ? '✅ PASS' : '🔴 FAIL'} — billing money flow is ${ok ? 'LIVE + SECURE end-to-end over its headless envelope (create + unspoofable webhook + causal-integrity + honest free-lock + portal)' : `broken (${fails} leg(s) failed)`}.`,
  );
  if (ok && liveMode)
    console.log(
      '   ↳ OUT OF HEADLESS SCOPE (prod is Stripe LIVE-mode): real card → checkout.session.completed → subscription active → entitlement unlock. Covered by the webhook handler unit tests; a real charge is approval-required.',
    );
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
