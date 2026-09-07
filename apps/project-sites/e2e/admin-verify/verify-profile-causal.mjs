#!/usr/bin/env node
/**
 * verify-profile-causal.mjs — CAUSAL write→read-back for the user-profile update
 * (`PATCH /api/admin/profile`), the /admin/user section's display-name write.
 *
 * Dim-3 (TRUTHFUL MUTATIONS) gap: the 15 existing causal probes cover site/media/
 * env-var/token/mcp/webhook/team/newsletter/notification-prefs writes — but NOT the
 * user-profile update. That handler does `UPDATE users SET display_name WHERE id =
 * <caller userId>` and returns `{data:{display_name}}`; a lying-success (200 while the
 * row didn't change) or a wrong-user write would leave the /admin/user surface showing
 * a stale/wrong name. This probe proves the write actually persists + is user-scoped:
 *
 *   GET /api/auth/me (capture original) → PATCH new name → GET me (== new, persisted)
 *   → PATCH restore original → GET me (== original). Plus an empty-name → 4xx validation
 *   check (non-mutating). Fully self-cleaning (finally reconciles to the true original).
 *
 * Read-back source is `/api/auth/me` (display==store for the users row) per
 * verify-against-source-of-truth. Fail-open: skips (exit 0) on unset E2E_API_KEY.
 * Auto-joins run-all via the `verify-*-causal.mjs` glob.
 *
 * Run:  E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-profile-causal.mjs
 */
import { resolveSecret } from './_browserbase-creds.mjs';

const KEY = resolveSecret('E2E_API_KEY');
const API = process.env.RECONCILE_API_BASE || 'https://project-sites.manhattan.workers.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { authorization: `Bearer ${KEY}`, 'user-agent': UA, Origin: 'https://projectsites.dev', 'content-type': 'application/json' };

if (!KEY) {
  console.log('::notice:: verify-profile-causal skipped — E2E_API_KEY unset');
  process.exit(0);
}

const me = async () => {
  const res = await fetch(`${API}/api/auth/me`, { headers: H });
  const j = await res.json().catch(() => null);
  const d = j?.data ?? j;
  return typeof d?.display_name === 'string' ? d.display_name : null;
};
const setName = async (name) => {
  const res = await fetch(`${API}/api/admin/profile`, { method: 'PATCH', headers: H, body: JSON.stringify({ name }) });
  return res.status;
};

let realName = null; // the true original — the finally reconciles to this, always.
try {
  realName = await me();
  if (realName === null) {
    console.log('::notice:: verify-profile-causal skipped — /api/auth/me carries no user display_name (org-only key?)');
    process.exit(0);
  }

  const probe = `ps-e2e-profile-${Date.now().toString(36)}`;

  const wStatus = await setName(probe); // 1) WRITE
  const afterWrite = await me(); // 2) READ-BACK — persisted, no lying-success
  const rStatus = await setName(realName); // 3) RESTORE
  const afterRestore = await me(); // 4) READ-BACK restored
  const emptyStatus = await setName(''); // 5) VALIDATION — empty rejected pre-write (non-mutating)

  const writeOk = wStatus === 200;
  const persistedOk = afterWrite === probe;
  const restoreOk = rStatus === 200 && afterRestore === realName;
  const validationOk = emptyStatus >= 400; // ZodError → 400 BEFORE the UPDATE
  const ok = writeOk && persistedOk && restoreOk && validationOk;

  console.log('\n=== PROFILE causal (display-name write→read-back→restore) ===');
  console.log(`  ${writeOk ? '✓' : '✗'} PATCH profile → 200 (status=${wStatus})`);
  console.log(`  ${persistedOk ? '✓' : '✗'} read-back /api/auth/me == new name (persisted, no lying-success)`);
  console.log(`  ${restoreOk ? '✓' : '✗'} restore → original ("${afterRestore}")`);
  console.log(`  ${validationOk ? '✓' : '✗'} empty name rejected 4xx pre-write (status=${emptyStatus})`);
  console.log(`\nVERDICT: ${ok ? '✅ PASS' : '🔴 FAIL'} — profile write ${ok ? 'persists truthfully + user-scoped + validated + self-restored' : 'FAILED (see ✗)'}`);
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
} finally {
  // Never leave the real user renamed to a probe/empty value: reconcile to the true original.
  if (realName !== null) {
    const cur = await me().catch(() => null);
    if (cur !== realName) {
      await setName(realName).catch(() => {});
      console.log(`  ↳ cleanup: reconciled display_name back to "${realName}"`);
    }
  }
}
