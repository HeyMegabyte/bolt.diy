/**
 * API coverage — flag-gated / zero-e2e-reference route families.
 *
 * A sweep over route families that had NO prod E2E reference (storefront,
 * concierge, agentic-commerce, site-dna, experiments, domain-stack, review-links,
 * jobs). A POPULATED 2xx from an UNAUTHENTICATED caller here means a
 * flag/ownership gate is missing — the class that leaked the D1 schema via
 * /export in Pass 25.
 *
 * Contract: unauth `request` MUST return a gate (401 / 402 / 403 / 404) — never a
 * 5xx, and never a 2xx that LEAKS another org's rows.
 *
 * Two endpoints are safe-by-design and verified in code (Pass 26), so they get a
 * relaxed-but-still-leak-proof contract:
 *  - `GET /api/sites/:id/products` — org-scoped read that short-circuits to an
 *    EMPTY list for unauth (`src/routes/storefront.ts` `if (!orgId) return { products: [] }`).
 *    Accepted: a gate OR `200 { products: [] }` (empty). A populated list = FAIL.
 *  - `GET /api/sites/:id/experiments` — `requirePro` middleware returns 402
 *    PRO_REQUIRED for a non-pro/unauth caller (`src/services/pro.ts`).
 *
 * Authenticates nothing; `request` fixture only; never mutates prod.
 *
 * @see {@link ../../src/index.ts}
 */
import { test, expect } from '@playwright/test';
import { resilientGet, resilientPost } from '../helpers/api-request.js';
import type { APIResponse } from '@playwright/test';

const PROD = process.env.PROD_URL ?? 'https://projectsites.dev';

/** Leak-free gate band. 402 = Pro-required (a legitimate gate on pro features). */
const GATE = [401, 402, 403, 404];

const ID = 'e2e-probe-1';
const HOST = 'probe.example.com';

/** Assert a response is a gate, OR a 200 whose `key` collection is empty (no leak). */
async function expectGatedOrEmpty(res: APIResponse, key: string): Promise<void> {
  const s = res.status();
  if (GATE.includes(s)) return;
  expect(s, `must be a gate or an empty 200 — got ${s}`).toBe(200);
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
  const coll = (body?.[key] ?? (body?.data as Record<string, unknown>)?.[key] ?? []) as unknown[];
  expect(Array.isArray(coll) ? coll.length : 1, `unauth 200 must not leak ${key}`).toBe(0);
}

test.describe('Flag-gated route families — unauthenticated safety gate (P10 coverage)', () => {
  test('GET /api/sites/:id/products — unauth gated or empty (storefront)', async ({ request }) => {
    await expectGatedOrEmpty(await resilientGet(request, `${PROD}/api/sites/${ID}/products`), 'products');
  });

  test('GET /api/storefront/products — unauth is gated (storefront alt)', async ({ request }) => {
    const res = await resilientGet(request, `${PROD}/api/storefront/products`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('POST /api/sites/:id/concierge — unauth is gated (RAG concierge)', async ({ request }) => {
    const res = await resilientPost(request, `${PROD}/api/sites/${ID}/concierge`, { data: { query: 'hi' } });
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('GET /api/sites/:id/commerce/feed — unauth is gated (agentic-commerce)', async ({ request }) => {
    const res = await resilientGet(request, `${PROD}/api/sites/${ID}/commerce/feed`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('GET /api/site-dna/:id/history — unauth is gated (site-dna)', async ({ request }) => {
    const res = await resilientGet(request, `${PROD}/api/site-dna/${ID}/history`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('GET /api/sites/:id/experiments — unauth is gated 402 pro (experiments)', async ({ request }) => {
    const res = await resilientGet(request, `${PROD}/api/sites/${ID}/experiments`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('GET /api/domains/:hostname/stack-status — unauth is gated (domain-stack)', async ({
    request,
  }) => {
    const res = await resilientGet(request, `${PROD}/api/domains/${HOST}/stack-status`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('GET /api/sites/:id/review-links — unauth is gated (review-links)', async ({ request }) => {
    const res = await resilientGet(request, `${PROD}/api/sites/${ID}/review-links`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('POST /api/jobs — unauth is gated (jobs)', async ({ request }) => {
    const res = await resilientPost(request, `${PROD}/api/jobs`, { data: { type: 'noop' } });
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('GET /api/jobs/:id/status — unauth is gated (jobs)', async ({ request }) => {
    const res = await resilientGet(request, `${PROD}/api/jobs/${ID}/status`);
    expect(GATE, `unauth must be gated — got ${res.status()}`).toContain(res.status());
  });

  // TDD Contract #10 — pathological :id values on the org-scoped products read
  // must never 5xx and never leak (unauth short-circuits to an empty list).
  const MALFORMED = ['a'.repeat(5000), '../../etc/passwd', "' OR 1=1--", '<script>alert(1)</script>', '你好', '%00'];
  for (const raw of MALFORMED) {
    test(`GET /api/sites/:id/products value-domain — ${raw.slice(0, 20)} never leaks, never 5xx`, async ({
      request,
    }) => {
      const res = await resilientGet(request, `${PROD}/api/sites/${encodeURIComponent(raw)}/products`);
      expect(res.status(), `malformed id must never 5xx — got ${res.status()}`).toBeLessThan(500);
      await expectGatedOrEmpty(res, 'products');
    });
  }
});
