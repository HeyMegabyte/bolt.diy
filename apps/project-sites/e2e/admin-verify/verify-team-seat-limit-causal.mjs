#!/usr/bin/env node
/**
 * verify-team-seat-limit-causal.mjs — CAUSAL test that the team-invite WRITE is
 * gated by its SERVER-SIDE preconditions, not merely the disabled "Send invite"
 * button. `POST /api/team/invites` had NO causal coverage: a UI-only gate (button
 * `[disabled]="…||seatsFull()"` with no server check) would let a direct API call
 * over-fill seats or inject a privileged role + fire an invite email — invisible to
 * the read-only reconcile sweep. This locks in `action-button-must-gate-on-server-
 * precondition` for the one team mutation.
 *
 * On the free-plan e2e-test-org (seat limit = 1, ≥1 owner ⇒ always at/over cap):
 *   1. baseline    — GET /api/team → pending-invite count.
 *   2. role guard  — POST {role:'superadmin'} → 400 (Zod clamps role to owner|editor|viewer,
 *                    BEFORE the seat check — a 409 here means the privilege guard regressed).
 *   3. seat cap    — POST {role:'viewer'}      → 409 "Seat limit reached" (server enforces the cap).
 *   4. no-write    — GET /api/team → pending count UNCHANGED (neither rejected attempt
 *                    inserted a team_invites row or sent an email; both reject BEFORE the INSERT).
 *
 * Read-only in effect (every attempt is rejected before any mutation), so nothing to
 * clean up and no email is ever sent. Pure-API on prod with the `Origin` header (omitting
 * it trips Bot Fight). Skips (exit 0) when E2E_API_KEY is unset, when /api/team isn't
 * reachable, or when the org is somehow under its seat cap — never false-fails.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-team-seat-limit-causal.mjs
 */
const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-team-seat-limit-causal skipped — E2E_API_KEY unset');
  process.exit(0);
}

const BASE = process.env.PROD_URL || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'User-Agent': UA, Origin: BASE };
const api = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
const unwrap = (d) => d?.data ?? d;
const teamState = async () => {
  const r = await api('/api/team');
  if (r.status !== 200) return { status: r.status, members: [], invites: [] };
  const d = unwrap(await r.json().catch(() => ({}))) ?? {};
  return { status: 200, members: d.members ?? [], invites: d.invites ?? [] };
};

try {
  const before = await teamState();
  if (before.status !== 200) {
    console.log(`::notice:: verify-team-seat-limit-causal skipped — GET /api/team returned ${before.status}`);
    process.exit(0);
  }
  const usage = before.members.length + before.invites.length;
  // Free plan seat limit is 1; a real org always has ≥1 owner, so it is always at/over
  // cap. If usage is somehow 0 we can't assert the 409 — skip rather than false-fail.
  if (usage < 1) {
    console.log('::notice:: verify-team-seat-limit-causal skipped — org is under its seat cap (nothing to enforce)');
    process.exit(0);
  }

  const rows = [];
  let fails = 0;
  const check = (label, ok, detail) => { rows.push({ label, ok, detail }); if (!ok) fails++; };

  const email = `seatcap-causal-${Date.now()}@example.com`;

  // 2. Privilege guard — an injected role must be rejected at the Zod boundary (400),
  //    NOT fall through to the seat check (409). This is a real escalation guard.
  const roleRes = await api('/api/team/invites', {
    method: 'POST',
    body: JSON.stringify({ email, role: 'superadmin' }),
  });
  check('injected role "superadmin" → 400 (Zod privilege clamp)', roleRes.status === 400, `got ${roleRes.status}`);

  // 3. Seat cap — a valid-role invite must be rejected server-side at the seat limit (409).
  const capRes = await api('/api/team/invites', {
    method: 'POST',
    body: JSON.stringify({ email, role: 'viewer' }),
  });
  check('valid invite at seat limit → 409 (server-enforced cap)', capRes.status === 409, `got ${capRes.status}`);

  // 4. No-write — neither rejected attempt may have created a pending invite row.
  const after = await teamState();
  const pendingUnchanged = after.invites.length === before.invites.length;
  const noGhost = !after.invites.some((i) => i?.email === email);
  check(
    'no team_invites row created by the rejected attempts',
    pendingUnchanged && noGhost,
    `pending ${before.invites.length}→${after.invites.length}`,
  );

  for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label.padEnd(52)} ${r.detail}`);
  const ok = fails === 0;
  console.log(
    `\nVERDICT: ${ok ? '✅ PASS' : '🔴 CHECK'} — team-invite seat cap + role guard ${ok ? 'enforced SERVER-SIDE (button is not the only gate)' : 'did NOT enforce server-side'}`,
  );
  if (!ok) console.log('   ↳ a 200/201 here = UI-only gate: the write is not truly gated on the server precondition.');
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
