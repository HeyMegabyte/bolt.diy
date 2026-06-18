#!/usr/bin/env node
/**
 * Prod smoke for the live MCP + OAuth wedge. Plain `fetch` (no Playwright/server),
 * so it runs anywhere: `node e2e/mcp-live-smoke.mjs [base-url]`.
 *
 * Asserts the discovery chain + the platform MCP + the OAuth authorization server
 * against PROD. The `tools/list → 11 tools` check is the regression guard for the
 * routing bug (commit 181dc381) where mcpSite's POST /:slug/mcp shadowed POST
 * /api/mcp — GET worked but POST 404'd, so only a live POST assertion catches it.
 *
 * Exit 0 = all green; exit 1 = a check failed (prints which).
 */
const BASE = process.argv[2] || process.env.PROD_URL || 'https://projectsites.dev';
const UA = 'projectsites-mcp-live-smoke';

let failures = 0;
function check(name, cond, detail = '') {
  const ok = !!cond;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
}
const get = (p) => fetch(`${BASE}${p}`, { headers: { 'user-agent': UA } });
const post = (p, body) =>
  fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function main() {
  console.log(`MCP live smoke → ${BASE}\n`);

  // 1. RFC 9728 PRM — authorization_servers must be the bare issuer (discovery chain).
  const prm = await (await get('/.well-known/oauth-protected-resource')).json();
  check('PRM authorization_servers is the bare issuer', prm.authorization_servers?.[0] === BASE, JSON.stringify(prm.authorization_servers));

  // 2. RFC 8414 AS metadata — present, S256, endpoints share the issuer origin.
  const asRes = await get('/.well-known/oauth-authorization-server');
  check('AS metadata is 200 (mcp_oauth_provider live)', asRes.status === 200, `HTTP ${asRes.status}`);
  if (asRes.status === 200) {
    const as = await asRes.json();
    check('AS advertises S256', as.code_challenge_methods_supported?.includes('S256'));
    const origin = (u) => { try { return new URL(u).origin; } catch { return null; } };
    const iss = origin(as.issuer);
    check('AS endpoints share the issuer origin', ['authorization_endpoint', 'token_endpoint', 'registration_endpoint'].every((k) => origin(as[k]) === iss));
  }

  // 3. Platform MCP discovery (GET) + tools/list (POST) — the routing-bug guard.
  const manifest = await (await get('/api/mcp')).json();
  check('GET /api/mcp manifest lists 11 tools', manifest.tools?.length === 11, `${manifest.tools?.length} tools`);
  const toolsList = await (await post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
  check('POST /api/mcp tools/list returns 11 tools (not shadowed by mcpSite)', toolsList.result?.tools?.length === 11, `${toolsList.result?.tools?.length} — ${toolsList.error?.message ?? 'ok'}`);

  // 4. Unauthenticated tools/call → 401 + WWW-Authenticate (RFC 9728 auto-discovery).
  const unauth = await post('/api/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami' } });
  check('Unauthenticated tools/call is 401', unauth.status === 401, `HTTP ${unauth.status}`);
  check('401 carries WWW-Authenticate → PRM', (unauth.headers.get('www-authenticate') ?? '').includes('resource_metadata='));

  // 5. OAuth DCR — a client can self-register (loopback redirect).
  const reg = await (await post('/oauth/register', { client_name: 'live-smoke', redirect_uris: ['http://127.0.0.1:8976/cb'] })).json();
  check('OAuth /oauth/register issues a client_id', typeof reg.client_id === 'string' && reg.client_id.length > 0);

  // 6. Token endpoint rejects a bogus code with invalid_grant (PKCE flow intact).
  const tok = await post('/oauth/token', { grant_type: 'authorization_code', code: 'nope', client_id: 'x', redirect_uri: 'http://127.0.0.1:8976/cb', code_verifier: 'a'.repeat(48) });
  const tokBody = await tok.json();
  check('OAuth /oauth/token rejects a bad code (invalid_grant)', tok.status === 400 && tokBody.error === 'invalid_grant', `HTTP ${tok.status} ${tokBody.error}`);

  console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('smoke crashed:', e.message); process.exit(1); });
