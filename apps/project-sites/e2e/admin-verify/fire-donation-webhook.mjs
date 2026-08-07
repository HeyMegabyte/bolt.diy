#!/usr/bin/env node
/** fire-donation-webhook.mjs — forge an HMAC-signed Stripe `checkout.session.completed`
 * event tagged `metadata.kind=donation` and POST it to the worker's `/webhooks/stripe`
 * on the workers.dev URL (BFM-exempt — the prod zone's Bot Fight Mode would challenge a
 * direct POST). Causal-tests the donation recorder end-to-end: forged event → real
 * webhook (signature-verified) → donations D1 row + campaign. Creds (get-secret):
 * STRIPE_WEBHOOK_SECRET. Arg1: marker suffix (default: epoch). */
import crypto from 'node:crypto';
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const MARK = process.argv[2] || String(Date.now());
const URL = 'https://project-sites.manhattan.workers.dev/webhooks/stripe';
if (!SECRET) {
  console.log('::notice:: skipped — STRIPE_WEBHOOK_SECRET unset');
  process.exit(0);
}
const event = {
  id: `evt_test_causal_${MARK}`,
  type: 'checkout.session.completed',
  data: {
    object: {
      id: `cs_test_${MARK}`,
      object: 'checkout.session',
      amount_total: 2500,
      mode: 'payment',
      payment_intent: `pi_test_causal_${MARK}`,
      customer_details: { email: 'causal-donor@example.com' },
      metadata: {
        kind: 'donation',
        site_id: 'site-megabytespace-001',
        amount_cents: '2500',
        donor_name: 'Causal Donor',
      },
    },
  },
};
const body = JSON.stringify(event);
const t = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
const res = await fetch(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` },
  body,
});
console.log('fire-donation-webhook →', res.status, (await res.text()).slice(0, 160));
console.log('marker_payment_intent:', `pi_test_causal_${MARK}`);
