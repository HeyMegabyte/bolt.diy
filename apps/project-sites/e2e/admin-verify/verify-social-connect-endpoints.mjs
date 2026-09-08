#!/usr/bin/env node
/**
 * verify-social-connect-endpoints.mjs — CONTRACT probe for the Social section's 11
 * "+ Connect" controls (twitter/linkedin/facebook/instagram/threads/bluesky/reddit/
 * mastodon/discord/slack/telegram).
 *
 * Each platform card renders a "+ Connect" button; clicking calls
 * `GET /api/social/:provider/connect`. The render / reconcile / causal gates never
 * exercise these 11 controls, so a provider-id typo, a removed/renamed route, or a broken
 * adapter would silently make one Connect button return 404/5xx — and social.component's
 * error handler then toasts the MISLEADING "Couldn't start … — try again" (a 404/5xx won't
 * fix on retry). This asserts every provider returns a USABLE connect contract:
 *   • 200 + data.authorize_url          → OAuth popup flow, or
 *   • 200 + data.mode === 'paste_key'   → paste-credentials form, or
 *   • 501 + error.code APP_CREDS_MISSING → gracefully unconfigured (connect() toasts "not configured yet")
 * Anything else (404, other 5xx, or 200 without a usable field) is a broken/misleading control.
 *
 * The provider-id list mirrors social.component PLATFORMS[].id — keep in sync (a drift there
 * that this list doesn't follow is itself the class this catches). READ-ONLY (never starts an
 * OAuth flow or posts credentials). Fail-open (conditional-ci-gates): skips when E2E_API_KEY is
 * unset or no owned site resolves. Wired into run-all.mjs's explicit PROBES list.
 *
 * Run:  E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-social-connect-endpoints.mjs
 */
import { resolveSecret } from './_browserbase-creds.mjs';

const KEY = resolveSecret('E2E_API_KEY');
const API = process.env.RECONCILE_API_BASE || 'https://project-sites.manhattan.workers.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { authorization: `Bearer ${KEY}`, 'user-agent': UA };

if (!KEY) {
  console.log('::notice:: verify-social-connect-endpoints skipped — E2E_API_KEY unset');
  process.exit(0);
}

// The 11 provider ids the Social composer renders (social.component PLATFORMS[].id).
const PROVIDERS = [
  'twitter', 'linkedin', 'facebook', 'instagram', 'threads', 'bluesky',
  'reddit', 'mastodon', 'discord', 'slack', 'telegram',
];

// Resolve an owned site id from the authed list (no D1/CF-key dependency).
let SITE = '';
try {
  const r = await fetch(`${API}/api/sites`, { headers: H });
  const j = await r.json();
  const arr = Array.isArray(j) ? j : j.data || j.sites || [];
  SITE = arr[0]?.id || arr[0]?.slug || '';
} catch {
  /* fall through to skip */
}
if (!SITE) {
  console.log('::notice:: verify-social-connect-endpoints skipped — could not resolve an owned site id');
  process.exit(0);
}

const rows = [];
for (const p of PROVIDERS) {
  let status = 0;
  let kind = '?';
  let ok = false;
  try {
    const res = await fetch(`${API}/api/social/${p}/connect?site_id=${encodeURIComponent(SITE)}`, { headers: H });
    status = res.status;
    const j = await res.json().catch(() => ({}));
    const d = j?.data || {};
    if (status === 200 && typeof d.authorize_url === 'string' && d.authorize_url) {
      kind = 'oauth (authorize_url)';
      ok = true;
    } else if (status === 200 && d.mode === 'paste_key') {
      kind = 'paste_key';
      ok = true;
    } else if (status === 501 && j?.error?.code === 'APP_CREDS_MISSING') {
      kind = 'unconfigured (graceful 501)';
      ok = true;
    } else {
      kind = `BROKEN (${j?.error?.code || 'no usable contract'})`;
      ok = false;
    }
  } catch (e) {
    kind = `fetch-error: ${String(e).slice(0, 40)}`;
    ok = false;
  }
  rows.push({ p, status, kind, ok });
}

const fails = rows.filter((r) => !r.ok);
for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.p.padEnd(11)} HTTP ${r.status} · ${r.kind}`);
if (fails.length) {
  console.log(
    `\nVERDICT: ❌ FAIL — ${fails.length}/${PROVIDERS.length} social Connect control(s) return a broken/misleading contract (want authorize_url | paste_key | graceful 501).`,
  );
  process.exit(1);
}
console.log(
  `\nVERDICT: ✅ PASS — all ${PROVIDERS.length} social Connect controls return a usable contract (authorize_url | paste_key | graceful 501); no 404/5xx dead controls.`,
);
