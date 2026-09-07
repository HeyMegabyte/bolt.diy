#!/usr/bin/env node
/**
 * verify-notification-prefs-causal.mjs — CAUSAL test for the User-Settings notification
 * preference toggles (the cross-device sync half). Each toggle writes the FULL flat pref
 * map to `POST /api/admin/notifications` and hydrates from `GET /api/admin/notifications`
 * on a second device — but this mutation had NO causal coverage, so a lying-success
 * (200 that doesn't persist) or a dropped write would be invisible (the UI is localStorage-
 * first, so it would look fine locally while cross-device sync silently broke).
 *
 * Flow (self-cleaning — restores the user's real prefs): read baseline → flip ONE pref +
 * POST the full map → read-back (flip persisted, others intact) → POST baseline → confirm
 * restored. NOTE: POST is a FULL REPLACE (the client always sends the complete map), so a
 * partial POST clobbers — this probe always writes the whole map + restores the baseline.
 *
 * Pure-API on prod with the Origin header (omitting it trips Bot Fight). Skips (exit 0) when
 * E2E_API_KEY is unset or the org has no notification prefs to exercise.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-notification-prefs-causal.mjs
 */
const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-notification-prefs-causal skipped — E2E_API_KEY unset');
  process.exit(0);
}

const BASE = process.env.PROD_URL || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'User-Agent': UA, Origin: BASE };
const api = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(25000) });
const getPrefs = async () => {
  const r = await api('/api/admin/notifications');
  if (r.status !== 200) return { status: r.status, prefs: null };
  const d = (await r.json().catch(() => ({})))?.data ?? {};
  return { status: 200, prefs: d.prefs ?? null };
};

try {
  const base = await getPrefs();
  if (base.status !== 200 || !base.prefs || Object.keys(base.prefs).length < 1) {
    console.log(`::notice:: verify-notification-prefs-causal skipped — no notification prefs (status=${base.status})`);
    process.exit(0);
  }
  const keys = Object.keys(base.prefs);
  const flipKey = keys[0];
  const baseline = { ...base.prefs };
  const modified = { ...baseline, [flipKey]: !baseline[flipKey] };

  const rows = [];
  let fails = 0;
  const check = (label, ok, detail) => { rows.push({ label, ok, detail }); if (!ok) fails++; };

  // WRITE the full modified map.
  const postRes = await api('/api/admin/notifications', { method: 'POST', body: JSON.stringify({ prefs: modified }) });
  check('POST prefs → 200', postRes.status === 200, `status=${postRes.status}`);

  // READ-BACK: the flip persisted + the other prefs intact (no dropped write, no clobber).
  const after = await getPrefs();
  const flipped = after.prefs && after.prefs[flipKey] === modified[flipKey];
  const othersIntact = after.prefs && keys.filter((k) => k !== flipKey).every((k) => after.prefs[k] === baseline[k]);
  check('read-back — flipped pref persisted', !!flipped, `${flipKey}: ${baseline[flipKey]}→${after.prefs?.[flipKey]}`);
  check('read-back — other prefs intact', !!othersIntact, `${keys.length - 1} others unchanged`);

  // RESTORE the baseline (self-cleaning) + confirm.
  const restoreRes = await api('/api/admin/notifications', { method: 'POST', body: JSON.stringify({ prefs: baseline }) });
  const restored = (await getPrefs()).prefs;
  const restoredOk = restoreRes.status === 200 && restored && keys.every((k) => restored[k] === baseline[k]);
  check('restore baseline → prefs back to original', !!restoredOk, `restore=${restoreRes.status}`);

  for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label.padEnd(44)} ${r.detail}`);
  const ok = fails === 0;
  console.log(
    `\nVERDICT: ${ok ? '✅ PASS' : '🔴 CHECK'} — notification-prefs sync ${ok ? 'persists server-side (write→read-back→restore all real; cross-device sync works)' : 'did NOT round-trip (lying-success / dropped write / clobber)'}`,
  );
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
