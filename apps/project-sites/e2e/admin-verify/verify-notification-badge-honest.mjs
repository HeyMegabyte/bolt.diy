#!/usr/bin/env node
/**
 * verify-notification-badge-honest.mjs — RENDER-vs-ENDPOINT honesty guard for the
 * notification bell badge that rides in the admin topbar on EVERY page. The badge
 * renders `unreadCount()` (only when > 0), fed from `GET /api/notifications`'s
 * `unread_count`. Observed anomaly (AL-096, 2026-09-06): the badge showed "6" for
 * the e2e-test-user while the D1 `notifications` store held **0** rows for that user
 * and the live API returned `unread_count: 0` — a stale/lying badge (display ≠ the
 * authoritative count) on a universal element. A read-only reconcile can't see it
 * (the divergence is at the RENDER layer, not the API layer), so this reconciles the
 * settled badge DOM against the live API the same session actually receives.
 *
 *   • badge DOM number (hidden ⇒ 0, "9+" ⇒ ≥10)  ==  GET /api/notifications unread_count
 *   • bell aria-label ("Notifications, N unread") is consistent with that count
 *
 * Waits 7s so a first-paint/poll race settles (the same 0→value transient class as
 * the billing rolling-counter) — only a PERSISTENT mismatch fails. Local Chromium
 * (authed admin shell, not CF-challenged). Skips (exit 0) when E2E_API_KEY is unset.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-notification-badge-honest.mjs
 */
const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-notification-badge-honest skipped — E2E_API_KEY unset');
  process.exit(0);
}

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');
const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

try {
  const b = await chromium.launch();
  const p = await (
    await b.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  ).newPage();
  await p.goto(`${ORIGIN}/admin`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.evaluate(
    (k) => localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'e2e@megabyte.space', issuedAt: Date.now() })),
    KEY,
  );
  await p.goto(`${ORIGIN}/admin/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(7000); // let the initial fetch + any 60s-poll settle

  // Rendered badge (hidden ⇒ 0) + the bell's aria-label, plus the LIVE API value the
  // page can fetch with its own session (the authoritative current unread count).
  const observed = await p.evaluate(async () => {
    const badgeEl = document.querySelector('.bell-btn .badge, .notification-bell .badge');
    const raw = badgeEl ? (badgeEl.textContent || '').trim() : '';
    const badge = raw === '' ? 0 : raw === '9+' ? 10 : Number(raw) || 0;
    const bell = document.querySelector('[aria-label^="Notifications"]');
    const aria = bell ? bell.getAttribute('aria-label') : '(no bell)';
    let apiUnread = null;
    try {
      const sess = JSON.parse(localStorage.getItem('ps_session') || '{}');
      const r = await fetch('/api/notifications', { headers: { authorization: `Bearer ${sess.token}` } });
      if (r.ok) apiUnread = (await r.json()).unread_count ?? null;
    } catch { /* leave null */ }
    return { badge, raw, aria, apiUnread };
  });
  await b.close();

  const rows = [];
  let fails = 0;
  const check = (label, ok, detail) => { rows.push({ label, ok, detail }); if (!ok) fails++; };

  if (observed.apiUnread === null) {
    console.log('::notice:: verify-notification-badge-honest skipped — could not read /api/notifications in-page');
    process.exit(0);
  }

  // Render == endpoint: the badge must equal the live unread_count (the anomaly was 6 vs 0).
  check(
    'bell badge DOM == live API unread_count',
    observed.badge === observed.apiUnread || (observed.badge === 10 && observed.apiUnread >= 10),
    `badge=${observed.raw || '(hidden→0)'} api=${observed.apiUnread}`,
  );
  // aria-label consistency: >0 must announce "N unread"; 0 must NOT claim unread.
  const ariaClaimsUnread = /\bunread\b/.test(observed.aria);
  check(
    'bell aria-label consistent with count',
    observed.apiUnread > 0 ? ariaClaimsUnread : !ariaClaimsUnread,
    `aria="${observed.aria}" api=${observed.apiUnread}`,
  );

  for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label.padEnd(42)} ${r.detail}`);
  const ok = fails === 0;
  console.log(
    `\nVERDICT: ${ok ? '✅ PASS' : '🔴 CHECK'} — notification bell badge ${ok ? 'is honest (render == endpoint)' : 'DRIFTS from the live unread_count (stale/lying badge)'}`,
  );
  if (!ok) console.log('   ↳ a badge showing N while the API returns a different count = a lying badge on every admin page.');
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
