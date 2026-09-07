#!/usr/bin/env node
/**
 * verify-snapshot-lifecycle-causal.mjs — CAUSAL test for the /admin/snapshots control
 * set (create → read-back → RENAME → collision-guard → delete → gone). The snapshot
 * lifecycle had NO causal coverage, and dim-7 exercise (AL-099) found the RENAME control
 * dead: `PATCH /api/sites/:id/snapshots/:snapId` — documented in the create dialog as the
 * operator escape-hatch — returned 404 (the route didn't exist). This probe locks in the
 * newly-built PATCH endpoint + the whole lifecycle so a regression can't silently return.
 *
 *   1. create   — POST /sites/:id/snapshots {name}      → 200 + id, present in the list
 *   2. rename    — PATCH /sites/:id/snapshots/:snapId {name} → 200, read-back shows the new name
 *   3. collision — PATCH {name:<an existing snapshot's name>} → 409 (UNIQUE(site_id,name) guard)
 *   4. delete    — DELETE /sites/:id/snapshots/:snapId  → 200, gone from the list
 *
 * Self-cleaning (the DELETE leg removes the causal snapshot). Runs on a PUBLISHED site
 * (snapshots require a build); resolves one from the org and skips (exit 0) if none is
 * buildable. Pure-API on prod with the Origin header (omitting it trips Bot Fight). Skips
 * when E2E_API_KEY is unset so forks + secret-less CI stay green.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-snapshot-lifecycle-causal.mjs
 */
const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-snapshot-lifecycle-causal skipped — E2E_API_KEY unset');
  process.exit(0);
}

const BASE = process.env.PROD_URL || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'User-Agent': UA, Origin: BASE };
const api = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(40000) });
const unwrap = (d) => d?.data ?? d;
const listSnaps = async (sid) => unwrap(await (await api(`/api/sites/${sid}/snapshots`)).json().catch(() => ({}))) ?? [];

try {
  // Resolve a site that already has ≥1 snapshot (⇒ published/buildable; POST /snapshots
  // 400s on a site with no build). Scan the caller's sites for the first such.
  const sites = unwrap(await (await api('/api/sites?limit=100')).json().catch(() => ({}))) ?? [];
  const list = Array.isArray(sites) ? sites : sites.data ?? [];
  let siteId = process.env.CAUSAL_SITE_ID || '';
  let existing = [];
  if (siteId) {
    existing = await listSnaps(siteId);
  } else {
    for (const s of list) {
      const id = s.id || s.site_id;
      if (!id) continue;
      const snaps = await listSnaps(id);
      if (Array.isArray(snaps) && snaps.length >= 1) { siteId = id; existing = snaps; break; }
    }
  }
  if (!siteId) {
    console.log('::notice:: verify-snapshot-lifecycle-causal skipped — no published site with a snapshot to exercise');
    process.exit(0);
  }

  const rows = [];
  let fails = 0;
  const check = (label, ok, detail) => { rows.push({ label, ok, detail }); if (!ok) fails++; };
  const name = `causal-snap-${Date.now()}`;
  const existingName = (existing[0] && (existing[0].snapshot_name || existing[0].name)) || 'initial';

  // 1. CREATE
  const createRes = await api(`/api/sites/${siteId}/snapshots`, { method: 'POST', body: JSON.stringify({ name, description: 'causal probe' }) });
  const created = unwrap(await createRes.json().catch(() => ({})));
  const snapId = created?.id;
  check('create → 200/201 + id', (createRes.status === 200 || createRes.status === 201) && !!snapId, `status=${createRes.status} id=${snapId ?? 'none'}`);
  if (!snapId) throw new Error('create returned no id — cannot continue lifecycle');

  const afterCreate = await listSnaps(siteId);
  check('read-back — new snapshot present', afterCreate.some((s) => (s.snapshot_name || s.name) === name), `count=${afterCreate.length}`);

  // 2. RENAME (the previously-dead PATCH)
  const renamed = `${name}-renamed`;
  const patchRes = await api(`/api/sites/${siteId}/snapshots/${snapId}`, { method: 'PATCH', body: JSON.stringify({ name: renamed }) });
  const afterRename = await listSnaps(siteId);
  check('rename PATCH → 200 + read-back shows new name', patchRes.status === 200 && afterRename.some((s) => (s.snapshot_name || s.name) === renamed), `status=${patchRes.status}`);

  // 3. COLLISION guard — renaming to an existing name must 409, not 500 / not silently succeed.
  const clashRes = await api(`/api/sites/${siteId}/snapshots/${snapId}`, { method: 'PATCH', body: JSON.stringify({ name: existingName }) });
  check('rename to existing name → 409 (UNIQUE guard)', clashRes.status === 409, `status=${clashRes.status} (vs existing "${existingName}")`);

  // 4. DELETE → gone
  const delRes = await api(`/api/sites/${siteId}/snapshots/${snapId}`, { method: 'DELETE' });
  const afterDelete = await listSnaps(siteId);
  check('delete → 200 + gone', (delRes.status === 200 || delRes.status === 204) && !afterDelete.some((s) => s.id === snapId), `status=${delRes.status} finalCount=${afterDelete.length}`);

  for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label.padEnd(48)} ${r.detail}`);
  const ok = fails === 0;
  console.log(
    `\nVERDICT: ${ok ? '✅ PASS' : '🔴 CHECK'} — snapshot lifecycle (create→rename→collision-guard→delete) ${ok ? 'all real + persisted on ' + siteId : 'has a dead/broken control'}`,
  );
  if (!ok) console.log('   ↳ a 404 on the rename PATCH = the documented operator escape-hatch is still dead.');
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
