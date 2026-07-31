/**
 * @module e2e/helpers/api-request
 * @description Tarpit-resilient transport for pure-API (request-context) probes.
 *
 * Wraps `apiRequestContext.get/post` with bounded retries so per-IP edge
 * throttling can't hang a spec for the full test timeout.
 *
 * @remarks
 * Why this exists: when the full suite runs at 4 workers against prod, many
 * simultaneous request-context calls originate from ONE IP. The edge applies
 * per-IP concurrency throttling (a "tarpit"): a connection that would answer
 * in <1s standalone intermittently stalls ~30s under suite-level concurrency.
 * Which tests get tarpitted ROTATES across runs (whichever calls are in
 * flight when the per-IP budget saturates), producing flaky timeouts across
 * admin-sections-smoke, admin-voice-billing, admin-billing-journey,
 * golden-path, and integration-health API blocks.
 *
 * The fix is transport-level, never assertion-level:
 * - Per-attempt timeout of 12s (instead of one 30s+ hang) bounds each stall.
 * - Up to 3 attempts with 1s/3s backoff lets the per-IP budget drain between
 *   attempts.
 * - Retry fires ONLY on timeout/socket-class transport errors. Any real HTTP
 *   response — including 500s — returns immediately on the attempt that
 *   received it, so genuine server errors still surface in assertions.
 *
 * Browser-context traffic (`page.goto`, `page.route`-stubbed XHRs) is NOT
 * routed through this helper — the tarpit affects raw request-context
 * connections, and browser tests have their own waiting semantics.
 */
import { expect } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';

type GetOptions = Parameters<APIRequestContext['get']>[1];
type PostOptions = Parameters<APIRequestContext['post']>[1];

/** Maximum transport attempts per logical request. */
const MAX_ATTEMPTS = 3;

/** Per-attempt timeout — bounds a tarpitted connection to 12s, not 30s+. */
const PER_ATTEMPT_TIMEOUT_MS = 12_000;

/** Backoff before attempt 2 (1s) and attempt 3 (3s). */
const BACKOFF_MS: readonly number[] = [1_000, 3_000];

/**
 * Transport-level failure signatures that justify a retry. HTTP responses of
 * ANY status never reach this check — Playwright resolves those normally and
 * we return them untouched.
 */
const RETRYABLE_TRANSPORT_ERROR =
  /timeout|timed out|socket hang up|socket error|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|network error/i;

function isRetryableTransportError(err: unknown): err is Error {
  return err instanceof Error && RETRYABLE_TRANSPORT_ERROR.test(err.message);
}

async function withTransportRetry(
  label: string,
  fire: () => Promise<APIResponse>,
): Promise<APIResponse> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Any resolved response (200, 401, 404, 500, …) returns immediately —
      // a real HTTP status is a signal for the assertion, never retried.
      return await fire();
    } catch (err) {
      if (!isRetryableTransportError(err)) throw err;
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        const backoff = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
        console.warn(
          `[api-request] ${label} attempt ${attempt}/${MAX_ATTEMPTS} hit transport stall ` +
            `(${err.message.split('\n')[0]}); backing off ${backoff}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw new Error(
    `[api-request] ${label} failed after ${MAX_ATTEMPTS} attempts ` +
      `(per-attempt timeout ${PER_ATTEMPT_TIMEOUT_MS}ms). Last transport error: ` +
      `${lastError?.message ?? 'unknown'}`,
  );
}

/**
 * GET with tarpit-resilient transport: up to 3 attempts, 12s per attempt,
 * 1s/3s backoff, retrying ONLY on timeout/socket errors.
 *
 * @param request - Playwright request-context fixture.
 * @param url - Absolute URL or config-baseURL-relative path.
 * @param opts - Standard Playwright get options. An explicit `opts.timeout`
 *   overrides the 12s per-attempt default.
 * @returns The first attempt's resolved response — any HTTP status surfaces
 *   unretried (a 500 fails the caller's assertion, as it should).
 *
 * @example
 * const res = await resilientGet(request, `${PROD_URL}/api/health`);
 * expect(res.status()).toBe(200);
 */
export async function resilientGet(
  request: APIRequestContext,
  url: string,
  opts?: GetOptions,
): Promise<APIResponse> {
  return withTransportRetry(`GET ${url}`, () =>
    request.get(url, { timeout: PER_ATTEMPT_TIMEOUT_MS, ...opts }),
  );
}

/**
 * POST with tarpit-resilient transport: up to 3 attempts, 12s per attempt,
 * 1s/3s backoff, retrying ONLY on timeout/socket errors.
 *
 * @param request - Playwright request-context fixture.
 * @param url - Absolute URL or config-baseURL-relative path.
 * @param opts - Standard Playwright post options (`data`, `headers`, …). An
 *   explicit `opts.timeout` overrides the 12s per-attempt default.
 * @returns The first attempt's resolved response — any HTTP status surfaces
 *   unretried.
 *
 * @remarks Only use for probes that are safe to re-send (auth-gate checks,
 * signature-rejection checks). A tarpit timeout means no response was read,
 * but the request MAY still have reached the origin — never point this at an
 * endpoint where a duplicate delivery mutates real data.
 *
 * @example
 * const res = await resilientPost(request, `${PROD_URL}/api/billing/checkout`, {
 *   data: { success_url: 'https://example.com/ok', cancel_url: 'https://example.com/no' },
 * });
 * expect([401, 403]).toContain(res.status());
 */
export async function resilientPost(
  request: APIRequestContext,
  url: string,
  opts?: PostOptions,
): Promise<APIResponse> {
  return withTransportRetry(`POST ${url}`, () =>
    request.post(url, { timeout: PER_ATTEMPT_TIMEOUT_MS, ...opts }),
  );
}

/**
 * Assert a response status is in the allowed set, with a labeled failure
 * message that names the contract being checked.
 *
 * @param res - Response from `resilientGet`/`resilientPost` (or any APIResponse).
 * @param allowed - Acceptable status codes for this contract.
 * @param label - Human-readable contract name surfaced on failure.
 *
 * @example
 * const res = await resilientGet(request, `${PROD_URL}/api/billing/subscription`);
 * expectStatus(res, [401, 403], 'billing subscription auth gate');
 */
export function expectStatus(res: APIResponse, allowed: number[], label: string): void {
  expect(
    allowed,
    `${label}: expected status in [${allowed.join(', ')}] but got ${res.status()} from ${res.url()}`,
  ).toContain(res.status());
}
