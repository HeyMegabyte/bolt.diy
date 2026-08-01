/**
 * API coverage — AI-actions payment endpoints (safety-gated, flag `ai_payment_command`).
 *
 * These endpoints charge / refund / inspect REAL money + customer data via Stripe, so
 * an UNAUTHENTICATED caller MUST hit a clean leak-free gate — 401 (no session), 403
 * (forbidden), or 404 (flag off / no existence leak) — and NEVER a 2xx (which would
 * mean the endpoint ACTED or leaked payment/customer data) and never a 5xx.
 *
 * This spec asserts the unauthenticated GATE ONLY — it never authenticates, so NO real
 * charge/refund is ever attempted (specs never mutate prod). Closes a P10 zero-coverage
 * gap: `POST /api/ai-actions/payment-command` (+ refund/status/methods/customers) had
 * no E2E despite being the highest-risk (money) surface in the app.
 *
 * @see {@link ../../src/routes/api.ts} — the ai-actions payment handlers
 */

import { test, expect } from '@playwright/test';

const PROD = process.env.PROD_URL ?? 'https://projectsites.dev';

/** The only leak-free responses for an unauthenticated caller to a money endpoint. */
const GATE = [401, 403, 404];

/** Mutating POSTs — a 2xx here would mean an unauthenticated caller moved money. */
const POSTS = [
  { path: '/api/ai-actions/payment-command', body: { intent: 'charge', amount_cents: 100 } },
  { path: '/api/ai-actions/payment-refund', body: { payment_intent_id: 'pi_test', idempotency_key: 'k_test' } },
];

/** Reading GETs — a 2xx here would LEAK payment/customer data to an anonymous caller. */
const GETS = [
  '/api/ai-actions/payment-status/pi_test',
  '/api/ai-actions/payment-methods?customer=cus_test',
  '/api/ai-actions/customers?q=cus_test',
];

test.describe('AI-actions payments — unauthenticated safety gate (P10 coverage)', () => {
  for (const { path, body } of POSTS) {
    test(`POST ${path} — unauth is gated (401/403/404), never moves money`, async ({ request }) => {
      const res = await request.post(`${PROD}${path}`, { data: body });
      expect(
        GATE,
        `an unauthenticated money POST must be gated — got ${res.status()}`,
      ).toContain(res.status());
    });
  }

  for (const path of GETS) {
    test(`GET ${path} — unauth is gated (401/403/404), never leaks payment data`, async ({ request }) => {
      const res = await request.get(`${PROD}${path}`);
      expect(
        GATE,
        `an unauthenticated payment read must be gated — got ${res.status()}`,
      ).toContain(res.status());
    });
  }
});
