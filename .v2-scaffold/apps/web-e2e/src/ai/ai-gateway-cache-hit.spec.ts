/**
 * ai-gateway-cache-hit.spec.ts — TDD RED phase
 *
 * Cloudflare AI Gateway caches identical LLM calls. We MUST measure:
 *   1. Two identical requests with the same prompt + model.
 *   2. The second response's wall-clock time must be ≤ 10% of the first.
 *   3. The second response carries the `cf-aig-cache-status: HIT` header
 *      (the Cloudflare canonical name; some setups emit
 *      `X-AI-Gateway-Cache: HIT` — we accept both).
 *
 * The control-plane worker proxies AI Gateway under `/api/ai/chat`. The
 * Worker must forward AI Gateway response headers verbatim — that's
 * how the test confirms cache provenance without parsing AI Gateway
 * analytics.
 *
 * Per `[[auto-meta-work]]` § AI Gateway, every LLM call routes through
 * the gateway; this spec is the regression guard against accidentally
 * bypassing it (e.g., direct calls to `api.anthropic.com`).
 */

import { test, expect } from '../_fixtures/auth.js';

const ENDPOINT = '/api/ai/chat';
const IDENTICAL_PROMPT = {
  model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  messages: [{ role: 'user', content: 'What is the capital of Japan?' }],
  temperature: 0,
};

interface AiResponse {
  readonly content: string;
  readonly model: string;
}

test.describe('AI Gateway cache hit', () => {
  test.beforeEach(async ({ authedPage }) => {
    // Start at homepage per the hermetic-spec contract — every E2E starts at /.
    await authedPage.goto('/');
  });

  test('identical AI calls hit the gateway cache on second request', async ({
    authedPage,
  }) => {
    // ── 1) Cold call: cache MISS expected. ─────────────────────────────
    const coldStart = Date.now();
    const coldResponse = await authedPage.request.post(ENDPOINT, {
      data: IDENTICAL_PROMPT,
      headers: { 'Content-Type': 'application/json' },
    });
    const coldDuration = Date.now() - coldStart;
    expect(coldResponse.ok(), 'cold AI call must succeed').toBe(true);
    const coldHeaders = coldResponse.headers();
    const coldCacheStatus =
      coldHeaders['cf-aig-cache-status'] ?? coldHeaders['x-ai-gateway-cache'];
    expect(coldCacheStatus?.toUpperCase()).toMatch(/MISS|BYPASS|DYNAMIC|^$|^undefined$/);

    const coldBody = (await coldResponse.json()) as AiResponse;
    expect(coldBody.content?.length ?? 0, 'cold response must have content').toBeGreaterThan(0);

    // ── 2) Warm call: identical prompt. Expect HIT + ≤10% wall-time. ──
    const warmStart = Date.now();
    const warmResponse = await authedPage.request.post(ENDPOINT, {
      data: IDENTICAL_PROMPT,
      headers: { 'Content-Type': 'application/json' },
    });
    const warmDuration = Date.now() - warmStart;
    expect(warmResponse.ok(), 'warm AI call must succeed').toBe(true);

    const warmHeaders = warmResponse.headers();
    const warmCacheStatus =
      warmHeaders['cf-aig-cache-status'] ?? warmHeaders['x-ai-gateway-cache'];
    expect(
      warmCacheStatus,
      'second response must carry AI Gateway cache header',
    ).toBeTruthy();
    expect(warmCacheStatus!.toUpperCase()).toBe('HIT');

    // Wall-time gate: ≤ 10% of cold duration. Allow ≥30ms floor for tiny coldDurations.
    const budget = Math.max(30, Math.floor(coldDuration * 0.1));
    expect(
      warmDuration,
      `warm response (${warmDuration}ms) must be ≤ 10% of cold (${coldDuration}ms) — budget ${budget}ms`,
    ).toBeLessThanOrEqual(budget);

    // Body must match the cold response exactly — deterministic prompt.
    const warmBody = (await warmResponse.json()) as AiResponse;
    expect(warmBody.content).toBe(coldBody.content);
  });

  test('different prompt does NOT hit cache', async ({ authedPage }) => {
    // First call to warm something else.
    await authedPage.request.post(ENDPOINT, {
      data: IDENTICAL_PROMPT,
      headers: { 'Content-Type': 'application/json' },
    });

    // Different prompt → expect MISS / BYPASS.
    const diffResponse = await authedPage.request.post(ENDPOINT, {
      data: {
        ...IDENTICAL_PROMPT,
        messages: [{ role: 'user', content: 'What is the capital of Brazil?' }],
      },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(diffResponse.ok()).toBe(true);

    const diffHeaders = diffResponse.headers();
    const diffCacheStatus =
      diffHeaders['cf-aig-cache-status'] ?? diffHeaders['x-ai-gateway-cache'];
    if (diffCacheStatus) {
      expect(diffCacheStatus.toUpperCase()).not.toBe('HIT');
    }
  });

  test('AI Gateway request ID is exposed for debugging', async ({ authedPage }) => {
    // The control-plane MUST surface `cf-aig-request-id` so Sentry +
    // PostHog breadcrumbs can correlate user-facing errors to the
    // exact gateway log line.
    const response = await authedPage.request.post(ENDPOINT, {
      data: IDENTICAL_PROMPT,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.ok()).toBe(true);

    const headers = response.headers();
    const reqId = headers['cf-aig-request-id'] ?? headers['x-ai-gateway-request-id'];
    expect(reqId, 'response must include AI Gateway request id').toBeTruthy();
    expect(reqId!.length).toBeGreaterThan(8);
  });
});
