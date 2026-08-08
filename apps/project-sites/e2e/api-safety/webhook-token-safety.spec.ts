/**
 * API coverage — webhook + MCP-OAuth-callback forgery/unauth safety.
 *
 * These surfaces are reachable without a session BY DESIGN, so the gate is
 * signature / state verification, not auth. A forged Stripe event or an MCP
 * callback with a forged state MUST be rejected and never processed / stored.
 *
 * Contracts (per endpoint):
 * - `POST /webhooks/stripe` unsigned/forged → 400/401/403 (WEBHOOK_SIGNATURE_INVALID); never 2xx.
 * - `GET /api/mcp/:provider/callback` forged state → never a 200 success / stored token.
 * - `POST /api/mcp/:provider/paste` unauth → 401/403/404; never stores a key.
 * - `GET /api/mcp/connections` unauth → 401/403/404; never lists connections.
 *
 * Authenticates nothing; `request` fixture only.
 *
 * @see {@link ../../src/routes/webhooks.ts}
 * @see {@link ../../src/routes/mcp_oauth.ts}
 */
import { test, expect } from '@playwright/test';
import { resilientGet, resilientPost } from '../helpers/api-request.js';

const PROD = process.env.PROD_URL ?? 'https://projectsites.dev';

/** A forged/unsigned webhook must land in this band — never a 2xx. */
const SIG_GATE = [400, 401, 403];
/** Unauthenticated MCP management calls. */
const AUTH_GATE = [401, 403, 404];

test.describe('Webhook + MCP-OAuth callback — forgery/unauth safety (P10 coverage)', () => {
  test('POST /webhooks/stripe — no signature is rejected, never processed', async ({ request }) => {
    const res = await resilientPost(request, `${PROD}/webhooks/stripe`, { data: {} });
    expect(SIG_GATE, `unsigned stripe webhook must reject — got ${res.status()}`).toContain(res.status());
  });

  test('POST /webhooks/stripe — forged signature is rejected', async ({ request }) => {
    const res = await resilientPost(request, `${PROD}/webhooks/stripe`, {
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
      data: { type: 'checkout.session.completed' },
    });
    expect(SIG_GATE, `forged stripe webhook must reject — got ${res.status()}`).toContain(res.status());
  });

  test('POST /webhooks/stripe — empty body + no header is rejected', async ({ request }) => {
    const res = await resilientPost(request, `${PROD}/webhooks/stripe`, { headers: {}, data: '' });
    expect(SIG_GATE, `empty stripe webhook must reject — got ${res.status()}`).toContain(res.status());
  });

  for (const provider of ['github', 'stripe', 'google']) {
    test(`GET /api/mcp/${provider}/callback — forged state never completes a connection`, async ({
      request,
    }) => {
      const res = await resilientGet(request, 
        `${PROD}/api/mcp/${provider}/callback?code=fake&state=forged`,
        { maxRedirects: 0 },
      );
      const s = res.status();
      expect([302, 400, 401, 403, 404], `forged MCP callback must not succeed — got ${s}`).toContain(s);
      if (s === 200) {
        const body = JSON.stringify(await res.json().catch(() => ({})));
        expect(
          /"(connected|success)":\s*true|access_token|"token"/i.test(body),
          'forged MCP callback must not report a stored connection/token',
        ).toBe(false);
      }
    });
  }

  test('POST /api/mcp/:provider/paste — unauth never stores a key', async ({ request }) => {
    const res = await resilientPost(request, `${PROD}/api/mcp/resend/paste`, { data: { apiKey: 'fake' } });
    expect(AUTH_GATE, `unauth paste must be gated — got ${res.status()}`).toContain(res.status());
  });

  test('GET /api/mcp/connections — unauth never lists connections', async ({ request }) => {
    const res = await resilientGet(request, `${PROD}/api/mcp/connections`);
    expect(AUTH_GATE, `unauth connections list must be gated — got ${res.status()}`).toContain(res.status());
  });
});
